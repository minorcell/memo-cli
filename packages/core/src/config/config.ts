/** @file Configuration management: read/write ~/.memo/config.toml and path construction utilities. */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, parse as parsePath, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse as parseToml } from 'toml'
import type { AgentSessionOptions } from '@memo/core/types'

export type ProviderConfig = {
    name: string
    env_api_key: string
    model: string
    base_url?: string
}

export type ModelProfileOverride = {
    supports_parallel_tool_calls?: boolean
    supports_reasoning_content?: boolean
    context_window?: number
}

export type McpOAuthCredentialsStoreMode = 'auto' | 'keyring' | 'file'

export type MCPServerConfig =
    | {
          /** Default: start local process, connect via stdio. */
          type?: 'stdio'
          command: string
          args?: string[]
          /** Environment variables passed to local process (merged with current environment). */
          env?: Record<string, string>
          /** Subprocess stderr behavior (silent in TTY by default). */
          stderr?: 'inherit' | 'pipe' | 'ignore'
      }
    | {
          /** Connect to remote MCP via Streamable HTTP. */
          type?: 'streamable_http'
          url: string
          /** Additional request headers (e.g., authentication). */
          headers?: Record<string, string>
          /** codex-style field: additional request headers (prioritized over headers). */
          http_headers?: Record<string, string>
          /** codex-style field: Bearer token env var. */
          bearer_token_env_var?: string
      }

export type MemoConfig = {
    current_provider: string
    /** Optional model capability overrides keyed by model slug or provider:model. */
    model_profiles?: Record<string, ModelProfileOverride>
    /** Map of server name to server configuration */
    mcp_servers?: Record<string, MCPServerConfig>
    /** Persisted default active MCP servers for interactive sessions. */
    active_mcp_servers?: string[]
    /** Persisted default active skills (absolute SKILL.md paths). Undefined means all discovered skills. */
    active_skills?: string[]
    /** MCP OAuth credential store policy. */
    mcp_oauth_credentials_store_mode?: McpOAuthCredentialsStoreMode
    /** Optional callback port for MCP OAuth browser login. */
    mcp_oauth_callback_port?: number
    /** Automatic context compaction threshold percentage (1-100). */
    auto_compact_threshold_percent?: number
    providers: ProviderConfig[]
}

type ParsedMemoConfig = Omit<Partial<MemoConfig>, 'providers'> & { providers?: unknown }

const DEFAULT_MEMO_HOME = join(homedir(), '.memo')
const DEFAULT_SESSIONS_DIR = 'sessions'
const DEFAULT_CONTEXT_WINDOW = 120000
const DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT = 80

const DEFAULT_CONFIG: MemoConfig = {
    current_provider: 'deepseek',
    mcp_oauth_credentials_store_mode: 'auto',
    auto_compact_threshold_percent: DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT,
    providers: [
        {
            name: 'deepseek',
            env_api_key: 'DEEPSEEK_API_KEY',
            model: 'deepseek-chat',
            base_url: 'https://api.deepseek.com',
        },
    ],
    mcp_servers: {},
}

function normalizeAutoCompactThresholdPercent(value: unknown): number {
    if (typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 1 && value <= 100) {
        return value
    }
    return DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT
}

function normalizeModelProfileKey(key: string): string {
    return key.trim().toLowerCase()
}

function readContextWindow(override: ModelProfileOverride | undefined): number | undefined {
    if (
        typeof override?.context_window === 'number' &&
        Number.isFinite(override.context_window) &&
        override.context_window > 0
    ) {
        return Math.floor(override.context_window)
    }
    return undefined
}

export function resolveContextWindowForProvider(
    config: Pick<MemoConfig, 'model_profiles'>,
    provider: Pick<ProviderConfig, 'name' | 'model'>,
): number {
    const modelProfiles = config.model_profiles
    if (!modelProfiles) return DEFAULT_CONTEXT_WINDOW

    const normalizedProfiles = new Map<string, ModelProfileOverride>()
    for (const [key, value] of Object.entries(modelProfiles)) {
        normalizedProfiles.set(normalizeModelProfileKey(key), value)
    }

    const providerName = normalizeModelProfileKey(provider.name)
    const modelKey = normalizeModelProfileKey(provider.model)
    const providerKey = `${providerName}:${modelKey}`

    return (
        readContextWindow(normalizedProfiles.get(providerKey)) ??
        readContextWindow(normalizedProfiles.get(modelKey)) ??
        DEFAULT_CONTEXT_WINDOW
    )
}

function formatTomlKey(key: string) {
    return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)
}

function normalizeProviders(input: unknown): ProviderConfig[] {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return []

    const providers: ProviderConfig[] = []
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (!value) continue
        const entries = Array.isArray(value) ? value : [value]
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue
            const provider = { ...(entry as ProviderConfig) }
            if ((typeof provider.name !== 'string' || provider.name.length === 0) && key) {
                provider.name = key
            }
            providers.push(provider)
        }
    }
    return providers
}

function normalizeActiveSkills(input: unknown): string[] | undefined {
    if (!Array.isArray(input)) return undefined
    const items = input
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    return Array.from(new Set(items))
}

function normalizeModelProfiles(input: unknown): Record<string, ModelProfileOverride> | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined

    const normalized: Record<string, ModelProfileOverride> = {}
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const entry = value as Record<string, unknown>
        const override: ModelProfileOverride = {}

        if (typeof entry.supports_parallel_tool_calls === 'boolean') {
            override.supports_parallel_tool_calls = entry.supports_parallel_tool_calls
        }
        if (typeof entry.supports_reasoning_content === 'boolean') {
            override.supports_reasoning_content = entry.supports_reasoning_content
        }
        if (
            typeof entry.context_window === 'number' &&
            Number.isFinite(entry.context_window) &&
            entry.context_window > 0
        ) {
            override.context_window = Math.floor(entry.context_window)
        }

        if (Object.keys(override).length > 0) {
            normalized[key] = override
        }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined
}

function expandHome(path: string) {
    if (path.startsWith('~')) {
        return join(homedir(), path.slice(1))
    }
    return path
}

function serializeConfig(config: MemoConfig) {
    const providers = config.providers
        .map((p) => {
            const name = typeof p?.name === 'string' ? p.name : ''
            if (!name) return ''
            const key = formatTomlKey(name)
            const lines = [
                `[[providers.${key}]]`,
                `name = ${JSON.stringify(name)}`,
                `env_api_key = ${JSON.stringify(String(p.env_api_key ?? ''))}`,
                `model = ${JSON.stringify(String(p.model ?? ''))}`,
            ]
            if (p.base_url) {
                lines.push(`base_url = ${JSON.stringify(String(p.base_url))}`)
            }
            return lines.join('\n')
        })
        .filter(Boolean)
        .join('\n\n')

    const modelProfiles = config.model_profiles
        ? Object.entries(config.model_profiles)
              .map(([key, value]) => {
                  const lines: string[] = []
                  const tableKey = formatTomlKey(key)
                  lines.push(`[model_profiles.${tableKey}]`)
                  if (typeof value.supports_parallel_tool_calls === 'boolean') {
                      lines.push(`supports_parallel_tool_calls = ${value.supports_parallel_tool_calls}`)
                  }
                  if (typeof value.supports_reasoning_content === 'boolean') {
                      lines.push(`supports_reasoning_content = ${value.supports_reasoning_content}`)
                  }
                  if (
                      typeof value.context_window === 'number' &&
                      Number.isFinite(value.context_window) &&
                      value.context_window > 0
                  ) {
                      lines.push(`context_window = ${Math.floor(value.context_window)}`)
                  }
                  return lines.length > 1 ? lines.join('\n') : ''
              })
              .filter(Boolean)
              .join('\n\n')
        : ''

    let mcpSection = ''
    if (config.mcp_servers && Object.keys(config.mcp_servers).length > 0) {
        mcpSection = Object.entries(config.mcp_servers)
            .map(([name, conf]) => {
                if ('url' in conf) {
                    const lines = [`[mcp_servers.${name}]`]
                    lines.push(`type = "${conf.type ?? 'streamable_http'}"`)
                    lines.push(`url = "${conf.url}"`)
                    if (conf.bearer_token_env_var) {
                        lines.push(`bearer_token_env_var = ${JSON.stringify(conf.bearer_token_env_var)}`)
                    }
                    const headers = conf.http_headers ?? conf.headers
                    if (headers && Object.keys(headers).length > 0) {
                        const headerEntries = Object.entries(headers)
                            .map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`)
                            .join(', ')
                        const headerKey = conf.http_headers ? 'http_headers' : 'headers'
                        lines.push(`${headerKey} = { ${headerEntries} }`)
                    }
                    return lines.join('\n')
                }
                const argsLine = conf.args ? `args = ${JSON.stringify(conf.args)}` : ''
                const typeLine = conf.type ? `type = "${conf.type}"\n` : ''
                const stderrLine = conf.stderr ? `stderr = "${conf.stderr}"\n` : ''
                const base =
                    `[mcp_servers.${name}]\n${typeLine}command = "${conf.command}"\n${stderrLine}${argsLine}`.trimEnd()
                const envEntries = conf.env ? Object.entries(conf.env) : []
                if (envEntries.length === 0) return base
                const envLines = envEntries
                    .map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`)
                    .join('\n')
                return `${base}\n\n[mcp_servers.${name}.env]\n${envLines}`
            })
            .join('\n\n')
    }

    const mainLines = [`current_provider = "${config.current_provider}"`]
    if (Array.isArray(config.active_mcp_servers)) {
        mainLines.push(`active_mcp_servers = ${JSON.stringify(config.active_mcp_servers)}`)
    }
    if (Array.isArray(config.active_skills)) {
        mainLines.push(`active_skills = ${JSON.stringify(config.active_skills)}`)
    }
    const oauthStoreMode = config.mcp_oauth_credentials_store_mode
    if (oauthStoreMode === 'auto' || oauthStoreMode === 'keyring' || oauthStoreMode === 'file') {
        mainLines.push(`mcp_oauth_credentials_store_mode = ${JSON.stringify(oauthStoreMode)}`)
    }
    if (
        typeof config.mcp_oauth_callback_port === 'number' &&
        Number.isInteger(config.mcp_oauth_callback_port) &&
        config.mcp_oauth_callback_port > 0 &&
        config.mcp_oauth_callback_port <= 65535
    ) {
        mainLines.push(`mcp_oauth_callback_port = ${config.mcp_oauth_callback_port}`)
    }
    mainLines.push(
        `auto_compact_threshold_percent = ${normalizeAutoCompactThresholdPercent(
            config.auto_compact_threshold_percent,
        )}`,
    )
    const mainConfig = mainLines.join('\n')

    return [mainConfig, providers, modelProfiles, mcpSection].filter(Boolean).join('\n\n')
}

export async function writeMemoConfig(path: string, config: MemoConfig) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, serializeConfig(config), 'utf-8')
}

export type LoadedConfig = {
    config: MemoConfig
    home: string
    configPath: string
    needsSetup: boolean
}

export async function loadMemoConfig(): Promise<LoadedConfig> {
    const home = process.env.MEMO_HOME ? expandHome(process.env.MEMO_HOME) : DEFAULT_MEMO_HOME
    const configPath = join(home, 'config.toml')
    try {
        await access(configPath)
        const text = await readFile(configPath, 'utf-8')
        const parsed = parseToml(text) as ParsedMemoConfig
        const providers = normalizeProviders(parsed.providers)
        const activeMcpServers = Array.isArray(parsed.active_mcp_servers)
            ? parsed.active_mcp_servers.filter(
                  (name): name is string => typeof name === 'string' && name.trim().length > 0,
              )
            : undefined
        const activeSkills = normalizeActiveSkills(parsed.active_skills)
        const oauthStoreMode =
            parsed.mcp_oauth_credentials_store_mode === 'auto' ||
            parsed.mcp_oauth_credentials_store_mode === 'keyring' ||
            parsed.mcp_oauth_credentials_store_mode === 'file'
                ? parsed.mcp_oauth_credentials_store_mode
                : DEFAULT_CONFIG.mcp_oauth_credentials_store_mode
        const oauthCallbackPort =
            typeof parsed.mcp_oauth_callback_port === 'number' &&
            Number.isInteger(parsed.mcp_oauth_callback_port) &&
            parsed.mcp_oauth_callback_port > 0 &&
            parsed.mcp_oauth_callback_port <= 65535
                ? parsed.mcp_oauth_callback_port
                : undefined
        const autoCompactThresholdPercent = normalizeAutoCompactThresholdPercent(parsed.auto_compact_threshold_percent)
        const modelProfiles = normalizeModelProfiles(parsed.model_profiles)
        const merged: MemoConfig = {
            current_provider: parsed.current_provider ?? DEFAULT_CONFIG.current_provider,
            mcp_oauth_credentials_store_mode: oauthStoreMode,
            mcp_oauth_callback_port: oauthCallbackPort,
            auto_compact_threshold_percent: autoCompactThresholdPercent,
            providers,
            model_profiles: modelProfiles,
            mcp_servers: parsed.mcp_servers ?? {},
            active_mcp_servers: activeMcpServers,
            active_skills: activeSkills,
        }
        const needsSetup = !merged.providers.length
        return { config: needsSetup ? DEFAULT_CONFIG : merged, home, configPath, needsSetup }
    } catch {
        return { config: DEFAULT_CONFIG, home, configPath, needsSetup: true }
    }
}

export function selectProvider(config: MemoConfig, preferred?: string): ProviderConfig {
    const name = preferred || config.current_provider
    const found = config.providers.find((p) => p.name === name)
    if (found) return found
    return config.providers?.[0] ?? DEFAULT_CONFIG.providers[0]!
}

export function getSessionsDir(loaded: LoadedConfig, options: AgentSessionOptions) {
    const base = options.historyDir ?? join(loaded.home, DEFAULT_SESSIONS_DIR)
    const absoluteBase = expandHome(base)
    const projectPath = resolve(options.cwd ?? process.cwd())
    const root = parsePath(projectPath).root
    const relative = projectPath.slice(root.length)
    const segments = relative.split(/[\\/]+/).filter(Boolean)

    if (process.platform === 'win32') {
        const drive = /^([A-Za-z]):/.exec(root)?.[1]
        if (drive) {
            segments.unshift(drive.toUpperCase())
        }
    }

    if (segments.length === 0) {
        return join(absoluteBase, '-root')
    }

    const encodedProjectPath = `-${segments.map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, '_')).join('-')}`

    return join(absoluteBase, encodedProjectPath)
}

export function buildSessionPath(baseDir: string, sessionId: string) {
    const now = new Date()
    const yyyy = String(now.getFullYear())
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const HH = String(now.getHours()).padStart(2, '0')
    const MM = String(now.getMinutes()).padStart(2, '0')
    const SS = String(now.getSeconds()).padStart(2, '0')
    const date = `${yyyy}-${mm}-${dd}T${HH}-${MM}-${SS}`
    const safeId = sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
    const fileName = `${date}-${safeId}.jsonl`
    return join(baseDir, fileName)
}

/** 提供一个新的 sessionId，便于外部复用。 */
export function createSessionId() {
    return randomUUID()
}
