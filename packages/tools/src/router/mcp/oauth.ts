import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
    OAuthClientInformationMixed,
    OAuthClientMetadata,
    OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { MCPServerConfig } from '../types'

const OAUTH_FILE_VERSION = 1
const OAUTH_FILE_NAME = 'mcp-oauth.json'
const OAUTH_CALLBACK_TIMEOUT_MS = 300_000
const OAUTH_DISCOVERY_TIMEOUT_MS = 5_000
const OAUTH_DISCOVERY_HEADER = 'MCP-Protocol-Version'
const OAUTH_DISCOVERY_VERSION = '2024-11-05'
const KEYRING_SERVICE = 'memo-code.mcp.oauth'
const RUNTIME_CALLBACK_FALLBACK_PORT = 33333

export type McpOAuthCredentialsStoreMode = 'auto' | 'keyring' | 'file'
export type McpOAuthStoreBackend = 'keyring' | 'file'
export type McpAuthStatus = 'unsupported' | 'not_logged_in' | 'bearer_token' | 'oauth'

export type McpOAuthSettings = {
    memoHome?: string
    storeMode?: McpOAuthCredentialsStoreMode
    callbackPort?: number
}

export type McpOAuthCredential = {
    clientInformation?: OAuthClientInformationMixed
    tokens?: OAuthTokens
}

type StoredCredentialRecord = {
    url: string
    updatedAt: number
    credential: McpOAuthCredential
}

type OAuthCredentialFile = {
    version: number
    credentials: Record<string, StoredCredentialRecord>
}

type KeytarLike = {
    getPassword(service: string, account: string): Promise<string | null>
    setPassword(service: string, account: string, password: string): Promise<void>
    deletePassword(service: string, account: string): Promise<boolean>
}

type LoginCallbackHandle = {
    redirectUrl: string
    waitForCode: () => Promise<string>
    close: () => Promise<void>
}

function defaultClientMetadata(redirectUrl: string): OAuthClientMetadata {
    return {
        client_name: 'Memo Code',
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
    }
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
}

function normalizeServerUrl(url: string): string {
    return new URL(url).toString()
}

function normalizeStoreMode(mode: string | undefined): McpOAuthCredentialsStoreMode {
    if (mode === 'file' || mode === 'keyring' || mode === 'auto') return mode
    return 'auto'
}

function expandHome(path: string) {
    if (path === '~') return homedir()
    if (path.startsWith('~/')) return join(homedir(), path.slice(2))
    return path
}

function resolveMemoHome(settings?: McpOAuthSettings): string {
    if (settings?.memoHome?.trim()) {
        return expandHome(settings.memoHome.trim())
    }
    if (process.env.MEMO_HOME?.trim()) {
        return expandHome(process.env.MEMO_HOME.trim())
    }
    return join(homedir(), '.memo')
}

function oauthFilePath(settings?: McpOAuthSettings): string {
    return join(resolveMemoHome(settings), 'auth', OAUTH_FILE_NAME)
}

function computeCredentialKey(url: string): string {
    return createHash('sha256').update(normalizeServerUrl(url)).digest('hex')
}

function emptyOAuthFile(): OAuthCredentialFile {
    return {
        version: OAUTH_FILE_VERSION,
        credentials: {},
    }
}

async function readOAuthFile(settings?: McpOAuthSettings): Promise<OAuthCredentialFile> {
    const filePath = oauthFilePath(settings)
    try {
        const raw = await readFile(filePath, 'utf8')
        const parsed = JSON.parse(raw) as Partial<OAuthCredentialFile>
        if (parsed.version !== OAUTH_FILE_VERSION || !parsed.credentials) {
            return emptyOAuthFile()
        }
        return {
            version: OAUTH_FILE_VERSION,
            credentials: parsed.credentials,
        }
    } catch {
        return emptyOAuthFile()
    }
}

async function writeOAuthFile(settings: McpOAuthSettings | undefined, file: OAuthCredentialFile) {
    const filePath = oauthFilePath(settings)
    const tempPath = `${filePath}.tmp`
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(tempPath, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tempPath, filePath)
}

let cachedKeytarPromise: Promise<KeytarLike | null> | null = null

async function loadKeytar(): Promise<KeytarLike | null> {
    if (cachedKeytarPromise) {
        return cachedKeytarPromise
    }
    cachedKeytarPromise = (async () => {
        try {
            const dynamicImport = new Function('specifier', 'return import(specifier)') as (
                specifier: string,
            ) => Promise<unknown>
            const mod = await dynamicImport('keytar')
            const candidate = (mod as Record<string, unknown>).default ?? mod
            if (
                candidate &&
                typeof (candidate as KeytarLike).getPassword === 'function' &&
                typeof (candidate as KeytarLike).setPassword === 'function' &&
                typeof (candidate as KeytarLike).deletePassword === 'function'
            ) {
                return candidate as KeytarLike
            }
            return null
        } catch {
            return null
        }
    })()
    return cachedKeytarPromise
}

async function readFromFileStore(url: string, settings?: McpOAuthSettings): Promise<McpOAuthCredential | undefined> {
    const key = computeCredentialKey(url)
    const file = await readOAuthFile(settings)
    return file.credentials[key]?.credential
}

async function writeToFileStore(url: string, credential: McpOAuthCredential, settings?: McpOAuthSettings) {
    const key = computeCredentialKey(url)
    const file = await readOAuthFile(settings)
    file.credentials[key] = {
        url: normalizeServerUrl(url),
        updatedAt: Date.now(),
        credential,
    }
    await writeOAuthFile(settings, file)
}

async function deleteFromFileStore(url: string, settings?: McpOAuthSettings): Promise<boolean> {
    const key = computeCredentialKey(url)
    const file = await readOAuthFile(settings)
    if (!file.credentials[key]) {
        return false
    }
    delete file.credentials[key]
    await writeOAuthFile(settings, file)
    return true
}

async function readFromKeyring(keytar: KeytarLike, url: string): Promise<McpOAuthCredential | undefined> {
    const key = computeCredentialKey(url)
    const raw = await keytar.getPassword(KEYRING_SERVICE, key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<StoredCredentialRecord>
    return parsed.credential
}

async function writeToKeyring(keytar: KeytarLike, url: string, credential: McpOAuthCredential) {
    const key = computeCredentialKey(url)
    const payload: StoredCredentialRecord = {
        url: normalizeServerUrl(url),
        updatedAt: Date.now(),
        credential,
    }
    await keytar.setPassword(KEYRING_SERVICE, key, JSON.stringify(payload))
}

async function deleteFromKeyring(keytar: KeytarLike, url: string): Promise<boolean> {
    const key = computeCredentialKey(url)
    return keytar.deletePassword(KEYRING_SERVICE, key)
}

function shouldUseHeadersForRequest(serverUrl: string, requestUrl: URL): boolean {
    return new URL(serverUrl).origin === requestUrl.origin
}

function resolveServerHeaders(config: Extract<MCPServerConfig, { url: string }>): Record<string, string> {
    return { ...(config.http_headers ?? config.headers) }
}

function resolveDiscoveryPaths(basePath: string): string[] {
    const trimmed = basePath.replace(/^\/+|\/+$/g, '')
    if (!trimmed) {
        return ['/.well-known/oauth-authorization-server']
    }

    const values: string[] = []
    const pushUnique = (path: string) => {
        if (!values.includes(path)) {
            values.push(path)
        }
    }

    pushUnique(`/.well-known/oauth-authorization-server/${trimmed}`)
    pushUnique(`/${trimmed}/.well-known/oauth-authorization-server`)
    pushUnique('/.well-known/oauth-authorization-server')
    return values
}

function normalizeScopes(scopes: string[] | undefined): string | undefined {
    if (!scopes || scopes.length === 0) return undefined
    const cleaned = scopes
        .flatMap((scope) => scope.split(/[,\s]+/g))
        .map((scope) => scope.trim())
        .filter(Boolean)
    if (cleaned.length === 0) return undefined
    return cleaned.join(' ')
}

function parseCallbackPort(value: number | undefined): number | undefined {
    if (value === undefined) return undefined
    if (!Number.isInteger(value) || value <= 0 || value > 65535) {
        throw new Error(`Invalid MCP OAuth callback port "${value}". Use an integer between 1 and 65535.`)
    }
    return value
}

function browserCommand(url: string): { command: string; args: string[] } {
    if (process.platform === 'darwin') {
        return { command: 'open', args: [url] }
    }
    if (process.platform === 'win32') {
        return { command: 'cmd', args: ['/c', 'start', '', url] }
    }
    return { command: 'xdg-open', args: [url] }
}

export async function openExternalUrl(url: string): Promise<void> {
    const { command, args } = browserCommand(url)
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore',
        })
        let settled = false
        const finalize = (error?: Error) => {
            if (settled) return
            settled = true
            child.off('error', onError)
            child.off('spawn', onSpawn)
            if (error) {
                reject(error)
                return
            }
            resolve()
        }
        const onError = (error: Error) => {
            finalize(error)
        }
        const onSpawn = () => {
            finalize()
        }
        child.on('error', onError)
        child.on('spawn', onSpawn)
        child.unref()
    })
}

function createServerBoundFetch(serverUrl: string, defaultHeaders: Record<string, string>): FetchLike {
    return async (input, init) => {
        const requestUrl =
            typeof input === 'string' || input instanceof URL ? new URL(String(input), serverUrl) : new URL(input.url)
        const headers = new Headers(init?.headers ?? {})
        if (shouldUseHeadersForRequest(serverUrl, requestUrl)) {
            for (const [key, value] of Object.entries(defaultHeaders)) {
                if (!headers.has(key)) {
                    headers.set(key, value)
                }
            }
            if (!headers.has(OAUTH_DISCOVERY_HEADER)) {
                headers.set(OAUTH_DISCOVERY_HEADER, OAUTH_DISCOVERY_VERSION)
            }
        }

        return fetch(requestUrl, {
            ...init,
            headers,
        })
    }
}

async function supportsOAuthLoginWithHeaders(url: string, defaultHeaders: Record<string, string>): Promise<boolean> {
    const baseUrl = new URL(url)
    const fetchFn = createServerBoundFetch(url, defaultHeaders)
    const paths = resolveDiscoveryPaths(baseUrl.pathname)
    for (const path of paths) {
        const discoveryUrl = new URL(baseUrl.toString())
        discoveryUrl.pathname = path
        discoveryUrl.search = ''
        discoveryUrl.hash = ''

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), OAUTH_DISCOVERY_TIMEOUT_MS)
        try {
            const response = await fetchFn(discoveryUrl, {
                method: 'GET',
                signal: controller.signal,
            })
            if (!response.ok) continue
            const parsed = (await response.json()) as {
                authorization_endpoint?: unknown
                token_endpoint?: unknown
            }
            if (typeof parsed.authorization_endpoint === 'string' && typeof parsed.token_endpoint === 'string') {
                return true
            }
        } catch {
            continue
        } finally {
            clearTimeout(timer)
        }
    }

    return false
}

export async function supportsOAuthLogin(url: string): Promise<boolean> {
    return supportsOAuthLoginWithHeaders(url, {})
}

class MemoOAuthClientProvider implements OAuthClientProvider {
    private loaded = false
    private credential: McpOAuthCredential = {}
    private verifier: string | null = null
    readonly clientMetadata: OAuthClientMetadata

    constructor(
        private readonly serverUrl: string,
        private readonly settings: McpOAuthSettings | undefined,
        private readonly redirectUrlValue: string,
        private readonly handleRedirect: (authorizationUrl: URL) => void | Promise<void>,
        initialCredential?: McpOAuthCredential,
    ) {
        this.clientMetadata = defaultClientMetadata(redirectUrlValue)
        if (initialCredential) {
            this.credential = initialCredential
            this.loaded = true
        }
    }

    get redirectUrl() {
        return this.redirectUrlValue
    }

    private async ensureLoaded() {
        if (this.loaded) return
        const loaded = await getMcpOAuthCredential(this.serverUrl, this.settings)
        this.credential = loaded.credential ?? {}
        this.loaded = true
    }

    private async persist() {
        await setMcpOAuthCredential(this.serverUrl, this.credential, this.settings)
    }

    async clientInformation() {
        await this.ensureLoaded()
        return this.credential.clientInformation
    }

    async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
        await this.ensureLoaded()
        this.credential = {
            ...this.credential,
            clientInformation,
        }
        await this.persist()
    }

    async tokens() {
        await this.ensureLoaded()
        return this.credential.tokens
    }

    async saveTokens(tokens: OAuthTokens) {
        await this.ensureLoaded()
        this.credential = {
            ...this.credential,
            tokens,
        }
        await this.persist()
    }

    async redirectToAuthorization(authorizationUrl: URL) {
        await this.handleRedirect(authorizationUrl)
    }

    saveCodeVerifier(codeVerifier: string) {
        this.verifier = codeVerifier
    }

    codeVerifier() {
        if (!this.verifier) {
            throw new Error('OAuth code verifier is missing.')
        }
        return this.verifier
    }

    async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier') {
        await this.ensureLoaded()
        if (scope === 'all') {
            this.credential = {}
        } else if (scope === 'client') {
            this.credential = { ...this.credential, clientInformation: undefined }
        } else if (scope === 'tokens') {
            this.credential = { ...this.credential, tokens: undefined }
        } else if (scope === 'verifier') {
            this.verifier = null
            return
        }
        await this.persist()
    }
}

export async function getMcpOAuthCredential(
    url: string,
    settings?: McpOAuthSettings,
): Promise<{ backend: McpOAuthStoreBackend; credential?: McpOAuthCredential }> {
    const mode = normalizeStoreMode(settings?.storeMode)
    if (mode === 'file') {
        return {
            backend: 'file',
            credential: await readFromFileStore(url, settings),
        }
    }

    const keytar = await loadKeytar()
    if (mode === 'keyring') {
        if (!keytar) {
            throw new Error('Keyring storage is not available. Set mcp_oauth_credentials_store_mode = "file".')
        }
        return {
            backend: 'keyring',
            credential: await readFromKeyring(keytar, url),
        }
    }

    if (!keytar) {
        return {
            backend: 'file',
            credential: await readFromFileStore(url, settings),
        }
    }

    try {
        const keyringCredential = await readFromKeyring(keytar, url)
        if (keyringCredential) {
            return {
                backend: 'keyring',
                credential: keyringCredential,
            }
        }
    } catch {
        // Best-effort in auto mode: fall back to file.
    }

    return {
        backend: 'file',
        credential: await readFromFileStore(url, settings),
    }
}

export async function setMcpOAuthCredential(
    url: string,
    credential: McpOAuthCredential,
    settings?: McpOAuthSettings,
): Promise<{ backend: McpOAuthStoreBackend }> {
    const mode = normalizeStoreMode(settings?.storeMode)
    if (mode === 'file') {
        await writeToFileStore(url, credential, settings)
        return { backend: 'file' }
    }

    const keytar = await loadKeytar()
    if (mode === 'keyring') {
        if (!keytar) {
            throw new Error('Keyring storage is not available. Set mcp_oauth_credentials_store_mode = "file".')
        }
        await writeToKeyring(keytar, url, credential)
        return { backend: 'keyring' }
    }

    if (!keytar) {
        await writeToFileStore(url, credential, settings)
        return { backend: 'file' }
    }

    try {
        await writeToKeyring(keytar, url, credential)
        await deleteFromFileStore(url, settings).catch(() => undefined)
        return { backend: 'keyring' }
    } catch {
        await writeToFileStore(url, credential, settings)
        return { backend: 'file' }
    }
}

export async function deleteMcpOAuthCredential(
    url: string,
    settings?: McpOAuthSettings,
): Promise<{ backend: McpOAuthStoreBackend; removed: boolean }> {
    const mode = normalizeStoreMode(settings?.storeMode)
    if (mode === 'file') {
        const removed = await deleteFromFileStore(url, settings)
        return { backend: 'file', removed }
    }

    const keytar = await loadKeytar()
    if (mode === 'keyring') {
        if (!keytar) {
            throw new Error('Keyring storage is not available. Set mcp_oauth_credentials_store_mode = "file".')
        }
        const removed = await deleteFromKeyring(keytar, url)
        return { backend: 'keyring', removed }
    }

    let keyringRemoved = false
    if (keytar) {
        try {
            keyringRemoved = await deleteFromKeyring(keytar, url)
        } catch {
            keyringRemoved = false
        }
    }
    const fileRemoved = await deleteFromFileStore(url, settings)
    return {
        backend: keyringRemoved ? 'keyring' : 'file',
        removed: keyringRemoved || fileRemoved,
    }
}

export async function getMcpAuthStatus(config: MCPServerConfig, settings?: McpOAuthSettings): Promise<McpAuthStatus> {
    if (!('url' in config)) {
        return 'unsupported'
    }
    if (config.bearer_token_env_var) {
        return 'bearer_token'
    }

    const loaded = await getMcpOAuthCredential(config.url, settings)
    if (loaded.credential?.tokens?.access_token) {
        return 'oauth'
    }

    const supportsOAuth = await supportsOAuthLoginWithHeaders(config.url, resolveServerHeaders(config))
    return supportsOAuth ? 'not_logged_in' : 'unsupported'
}

async function createCallbackServer(callbackPort: number | undefined, timeoutMs: number): Promise<LoginCallbackHandle> {
    const port = parseCallbackPort(callbackPort)
    const host = '127.0.0.1'
    let closed = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    let resolveCode: ((code: string) => void) | null = null
    let rejectCode: ((error: Error) => void) | null = null

    const waitPromise = new Promise<string>((resolve, reject) => {
        resolveCode = resolve
        rejectCode = reject
    })

    const server = createServer((req, res) => {
        const requestUrl = new URL(req.url ?? '/', `http://${host}`)
        if (requestUrl.pathname !== '/callback') {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('Not found')
            return
        }

        const code = requestUrl.searchParams.get('code')
        const error = requestUrl.searchParams.get('error')
        const errorDescription = requestUrl.searchParams.get('error_description')

        if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<html><body><h1>Authentication complete.</h1><p>You can close this window.</p></body></html>')
            resolveCode?.(code)
            return
        }

        const message = errorDescription ?? error ?? 'OAuth callback missing code.'
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<html><body><h1>Authentication failed.</h1><p>${message}</p></body></html>`)
        rejectCode?.(new Error(message))
    })

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port ?? 0, host, () => {
            server.off('error', reject)
            resolve()
        })
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
        await new Promise<void>((resolve) => server.close(() => resolve()))
        throw new Error('Failed to resolve OAuth callback listener address.')
    }

    timeout = setTimeout(() => {
        rejectCode?.(new Error('Timed out waiting for OAuth callback.'))
    }, timeoutMs)
    timeout.unref?.()

    const close = async () => {
        if (closed) return
        closed = true
        if (timeout) {
            clearTimeout(timeout)
            timeout = null
        }
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    return {
        redirectUrl: `http://${host}:${address.port}/callback`,
        waitForCode: async () => {
            try {
                return await waitPromise
            } finally {
                await close()
            }
        },
        close,
    }
}

export type McpOAuthLoginResult = {
    backend: McpOAuthStoreBackend
}

export async function loginMcpServerOAuth(options: {
    serverName: string
    config: Extract<MCPServerConfig, { url: string }>
    scopes?: string[]
    settings?: McpOAuthSettings
    timeoutMs?: number
    onAuthorizationUrl?: (url: string) => void
    onBrowserOpenFailure?: (error: Error, url: string) => void
}): Promise<McpOAuthLoginResult> {
    if (options.config.bearer_token_env_var) {
        throw new Error(
            `Server "${options.serverName}" is configured with bearer_token_env_var. Remove it to use OAuth login.`,
        )
    }

    const headers = resolveServerHeaders(options.config)
    const supportsOAuth = await supportsOAuthLoginWithHeaders(options.config.url, headers)
    if (!supportsOAuth) {
        throw new Error(
            `Server "${options.serverName}" does not advertise OAuth support. Configure --bearer-token-env-var instead.`,
        )
    }

    const callback = await createCallbackServer(
        options.settings?.callbackPort,
        options.timeoutMs ?? OAUTH_CALLBACK_TIMEOUT_MS,
    )
    const fetchFn = createServerBoundFetch(options.config.url, headers)
    const provider = new MemoOAuthClientProvider(
        options.config.url,
        options.settings,
        callback.redirectUrl,
        async (authorizationUrl) => {
            const url = authorizationUrl.toString()
            options.onAuthorizationUrl?.(url)
            try {
                await openExternalUrl(url)
            } catch (error) {
                options.onBrowserOpenFailure?.(new Error(getErrorMessage(error)), authorizationUrl.toString())
            }
        },
    )

    try {
        const scope = normalizeScopes(options.scopes)
        const first = await auth(provider, {
            serverUrl: options.config.url,
            scope,
            fetchFn,
        })
        if (first === 'REDIRECT') {
            const code = await callback.waitForCode()
            const second = await auth(provider, {
                serverUrl: options.config.url,
                authorizationCode: code,
                scope,
                fetchFn,
            })
            if (second !== 'AUTHORIZED') {
                throw new Error('OAuth authorization did not complete.')
            }
        }

        const loaded = await getMcpOAuthCredential(options.config.url, options.settings)
        if (!loaded.credential?.tokens?.access_token) {
            throw new Error('OAuth login completed but no access token was stored.')
        }
        return {
            backend: loaded.backend,
        }
    } catch (error) {
        throw new Error(`OAuth login failed: ${getErrorMessage(error)}`)
    } finally {
        await callback.close()
    }
}

export async function logoutMcpServerOAuth(options: {
    config: Extract<MCPServerConfig, { url: string }>
    settings?: McpOAuthSettings
}): Promise<{ backend: McpOAuthStoreBackend; removed: boolean }> {
    return deleteMcpOAuthCredential(options.config.url, options.settings)
}

export async function createRuntimeMcpOAuthProvider(options: {
    serverName: string
    config: Extract<MCPServerConfig, { url: string }>
    settings?: McpOAuthSettings
}): Promise<OAuthClientProvider | null> {
    if (options.config.bearer_token_env_var) {
        return null
    }
    const loaded = await getMcpOAuthCredential(options.config.url, options.settings)
    if (!loaded.credential?.tokens?.access_token) {
        return null
    }

    const callbackPort = parseCallbackPort(options.settings?.callbackPort) ?? RUNTIME_CALLBACK_FALLBACK_PORT
    const redirectUrl = `http://127.0.0.1:${callbackPort}/callback`

    return new MemoOAuthClientProvider(
        options.config.url,
        options.settings,
        redirectUrl,
        async () => {
            throw new Error(
                `MCP server "${options.serverName}" requires OAuth login. Run: memo mcp login ${options.serverName}`,
            )
        },
        loaded.credential,
    )
}
