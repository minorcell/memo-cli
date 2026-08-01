import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { stableStringify } from '@memo/core/utils/serialize'
import type { MCPServerConfig } from '../types'

const CACHE_FILE_NAME = 'mcp.json'
const CACHE_SCHEMA_VERSION = 2
const CACHE_PERSIST_DEBOUNCE_MS = 120

const TOOLS_FRESH_TTL_MS = 10 * 60 * 1000
const TOOLS_MAX_STALE_MS = 24 * 60 * 60 * 1000

type CachedResponseEntry = {
    expiresAt: number
    value: unknown
}

export type CachedMcpToolDescriptor = {
    originalName: string
    description: string
    inputSchema: unknown
}

type CachedServerToolsEntry = {
    fetchedAt: number
    configHash: string
    tools: CachedMcpToolDescriptor[]
}

type McpCacheFile = {
    version: number
    toolsByServer: Record<string, CachedServerToolsEntry>
    responses: Record<string, CachedResponseEntry>
}

export type CachedServerToolsSnapshot = {
    tools: CachedMcpToolDescriptor[]
    stale: boolean
    ageMs: number
}

function isDiskCacheEnabled() {
    if (process.env.MEMO_FORCE_MCP_DISK_CACHE === '1') return true
    if (process.env.MEMO_FORCE_MCP_DISK_CACHE === '0') return false
    if (process.env.NODE_ENV === 'test') return false
    if (typeof process.env.VITEST !== 'undefined') return false
    if (typeof process.env.VITEST_WORKER_ID !== 'undefined') return false
    return true
}

function expandHomePath(value: string): string {
    if (value === '~') return homedir()
    if (value.startsWith('~/')) {
        return join(homedir(), value.slice(2))
    }
    return value
}

function resolveMemoHomeDir(): string {
    const configured = process.env.MEMO_HOME?.trim()
    if (configured) {
        return expandHomePath(configured)
    }
    return join(homedir(), '.memo')
}

function getCacheFilePath(): string {
    return join(resolveMemoHomeDir(), 'cache', CACHE_FILE_NAME)
}

function configHash(config: MCPServerConfig): string {
    return createHash('sha256').update(stableStringify(config)).digest('hex')
}

function getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

function defaultCacheData(): McpCacheFile {
    return {
        version: CACHE_SCHEMA_VERSION,
        toolsByServer: {},
        responses: {},
    }
}

export class McpCacheStore {
    private data: McpCacheFile = defaultCacheData()
    private loaded = false
    private loadPromise: Promise<void> | null = null
    private persistTimer: ReturnType<typeof setTimeout> | null = null
    private persistRunning = false
    private persistRequested = false
    private responseInflight = new Map<string, Promise<unknown>>()

    private pruneExpiredResponses(now = Date.now()) {
        for (const [key, entry] of Object.entries(this.data.responses)) {
            if (entry.expiresAt <= now) {
                delete this.data.responses[key]
            }
        }
    }

    private pruneExpiredTools(now = Date.now()) {
        for (const [serverName, entry] of Object.entries(this.data.toolsByServer)) {
            if (now - entry.fetchedAt > TOOLS_MAX_STALE_MS) {
                delete this.data.toolsByServer[serverName]
            }
        }
    }

    private async ensureLoaded(): Promise<void> {
        if (!isDiskCacheEnabled()) {
            this.loaded = true
            return
        }
        if (this.loaded) return
        if (this.loadPromise) {
            await this.loadPromise
            return
        }

        this.loadPromise = (async () => {
            const cachePath = getCacheFilePath()
            try {
                const raw = await readFile(cachePath, 'utf8')
                const parsed = JSON.parse(raw) as
                    | McpCacheFile
                    | {
                          version?: number
                          entries?: Record<string, CachedResponseEntry>
                      }

                if (parsed.version === CACHE_SCHEMA_VERSION) {
                    const data = parsed as McpCacheFile
                    this.data = {
                        version: CACHE_SCHEMA_VERSION,
                        toolsByServer: data.toolsByServer ?? {},
                        responses: data.responses ?? {},
                    }
                } else if (parsed.version === 1 && parsed.entries) {
                    this.data = {
                        version: CACHE_SCHEMA_VERSION,
                        toolsByServer: {},
                        responses: parsed.entries,
                    }
                } else {
                    this.data = defaultCacheData()
                }
            } catch {
                this.data = defaultCacheData()
            } finally {
                this.pruneExpiredResponses()
                this.pruneExpiredTools()
                this.loaded = true
            }
        })()

        await this.loadPromise
    }

    private async persistToDisk(): Promise<void> {
        if (!isDiskCacheEnabled()) return
        this.pruneExpiredResponses()
        this.pruneExpiredTools()

        const cachePath = getCacheFilePath()
        const tempPath = `${cachePath}.tmp`
        const cacheDir = dirname(cachePath)
        await mkdir(cacheDir, { recursive: true })
        await writeFile(tempPath, JSON.stringify(this.data, null, 2), 'utf8')
        await rename(tempPath, cachePath)
    }

    private async flushPersistQueue(): Promise<void> {
        if (!this.persistRequested || this.persistRunning) return

        this.persistRequested = false
        this.persistRunning = true
        try {
            await this.persistToDisk()
        } catch {
            // Ignore cache persistence errors.
        } finally {
            this.persistRunning = false
            if (this.persistRequested) {
                void this.flushPersistQueue()
            }
        }
    }

    private schedulePersist() {
        if (!isDiskCacheEnabled()) return
        this.persistRequested = true
        if (this.persistTimer) return

        this.persistTimer = setTimeout(() => {
            this.persistTimer = null
            void this.flushPersistQueue()
        }, CACHE_PERSIST_DEBOUNCE_MS)
        this.persistTimer.unref?.()
    }

    async getServerTools(serverName: string, serverConfig: MCPServerConfig): Promise<CachedServerToolsSnapshot | null> {
        await this.ensureLoaded()
        const entry = this.data.toolsByServer[serverName]
        if (!entry) return null
        if (entry.configHash !== configHash(serverConfig)) {
            delete this.data.toolsByServer[serverName]
            this.schedulePersist()
            return null
        }

        const ageMs = Date.now() - entry.fetchedAt
        if (ageMs > TOOLS_MAX_STALE_MS) {
            delete this.data.toolsByServer[serverName]
            this.schedulePersist()
            return null
        }

        return {
            tools: entry.tools,
            stale: ageMs > TOOLS_FRESH_TTL_MS,
            ageMs,
        }
    }

    async setServerTools(
        serverName: string,
        serverConfig: MCPServerConfig,
        tools: CachedMcpToolDescriptor[],
    ): Promise<void> {
        await this.ensureLoaded()
        this.data.toolsByServer[serverName] = {
            fetchedAt: Date.now(),
            configHash: configHash(serverConfig),
            tools,
        }
        this.schedulePersist()
    }

    async withResponseCache<T>(cacheKey: string, ttlMs: number, loadValue: () => Promise<T>): Promise<T> {
        await this.ensureLoaded()

        const existing = this.data.responses[cacheKey]
        if (existing && existing.expiresAt > Date.now()) {
            return existing.value as T
        }
        if (existing && existing.expiresAt <= Date.now()) {
            delete this.data.responses[cacheKey]
        }

        const pending = this.responseInflight.get(cacheKey)
        if (pending) {
            return (await pending) as T
        }

        const created = (async () => {
            const value = await loadValue()
            this.data.responses[cacheKey] = {
                expiresAt: Date.now() + ttlMs,
                value,
            }
            this.schedulePersist()
            return value
        })()

        this.responseInflight.set(cacheKey, created as Promise<unknown>)
        try {
            return await created
        } catch (err) {
            throw new Error(getErrorMessage(err))
        } finally {
            this.responseInflight.delete(cacheKey)
        }
    }

    async flushForTests() {
        if (this.persistTimer) {
            clearTimeout(this.persistTimer)
            this.persistTimer = null
        }
        this.persistRequested = true
        await this.flushPersistQueue()
    }

    resetForTests() {
        this.data = defaultCacheData()
        this.loaded = false
        this.loadPromise = null
        this.responseInflight.clear()
        this.persistRequested = false
        this.persistRunning = false
        if (this.persistTimer) {
            clearTimeout(this.persistTimer)
            this.persistTimer = null
        }
    }
}

let globalMcpCacheStore: McpCacheStore | null = null

export function getGlobalMcpCacheStore() {
    if (!globalMcpCacheStore) {
        globalMcpCacheStore = new McpCacheStore()
    }
    return globalMcpCacheStore
}

export function resetGlobalMcpCacheStoreForTests() {
    globalMcpCacheStore?.resetForTests()
}
