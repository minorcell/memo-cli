/** @file MCP tool registry (stores standard AI SDK Tool objects). */
import { jsonSchema, type Tool } from 'ai'
import type { MCPServerConfig } from '../types'
import { McpClientPool } from './pool'
import { getGlobalMcpCacheStore, type CachedMcpToolDescriptor } from './cache_store'
import { setActiveMcpCacheStore, setActiveMcpPool } from './context'
import type { McpOAuthSettings } from './oauth'

/** MCP tool registry */
export class McpToolRegistry {
    private pool: McpClientPool
    private serverToolNames: Map<string, Set<string>> = new Map()
    private refreshPromises: Map<string, Promise<void>> = new Map()
    private tools: Map<string, Tool> = new Map()
    private cacheStore = getGlobalMcpCacheStore()
    private readonly shouldLog: boolean

    constructor() {
        this.pool = new McpClientPool()
        setActiveMcpPool(this.pool)
        setActiveMcpCacheStore(this.cacheStore)
        this.shouldLog = !(process.stdout.isTTY && process.stdin.isTTY)
    }

    /** Cached-descriptor placeholder tool: lazy-connects and delegates to the real MCP tool on execute. */
    private buildCachedTool(serverName: string, config: MCPServerConfig, descriptor: CachedMcpToolDescriptor): Tool {
        return {
            description: descriptor.description || `Tool from ${serverName}: ${descriptor.originalName}`,
            inputSchema: descriptor.inputSchema
                ? jsonSchema(descriptor.inputSchema as object)
                : jsonSchema({ type: 'object' }),
            execute: async (input, options) => {
                const connection = await this.pool.connect(serverName, config)
                const sdkTool = connection.tools[descriptor.originalName]
                if (!sdkTool?.execute) {
                    return { type: 'error-text', value: `MCP tool not found: ${descriptor.originalName}` }
                }
                return sdkTool.execute(input, options)
            },
        }
    }

    private replaceServerTools(serverName: string, nextTools: Record<string, Tool>) {
        const prev = this.serverToolNames.get(serverName)
        if (prev) {
            for (const toolName of prev) {
                this.tools.delete(toolName)
            }
        }

        const next = new Set<string>()
        for (const [toolName, tool] of Object.entries(nextTools)) {
            this.tools.set(toolName, tool)
            next.add(toolName)
        }
        this.serverToolNames.set(serverName, next)
    }

    private connectionToDescriptors(
        serverName: string,
        connection: Awaited<ReturnType<McpClientPool['connect']>>,
    ): CachedMcpToolDescriptor[] {
        return Object.entries(connection.tools).map(([originalName, tool]) => ({
            originalName,
            description: tool.description || `Tool from ${serverName}: ${originalName}`,
            inputSchema: (tool.inputSchema as { jsonSchema?: () => unknown }).jsonSchema?.(),
        }))
    }

    private async refreshServer(
        serverName: string,
        config: MCPServerConfig,
        mode: 'sync' | 'background',
    ): Promise<void> {
        const existing = this.refreshPromises.get(serverName)
        if (existing) {
            if (mode === 'sync') {
                await existing
            }
            return
        }

        const task = (async () => {
            try {
                const connection = await this.pool.connect(serverName, config)
                const descriptors = this.connectionToDescriptors(serverName, connection)
                await this.cacheStore.setServerTools(serverName, config, descriptors)
                const tools = Object.fromEntries(
                    Object.entries(connection.tools).map(([name, tool]) => [`${serverName}_${name}`, tool]),
                )
                this.replaceServerTools(serverName, tools)
                if (this.shouldLog && mode === 'background') {
                    console.log(`[MCP] Refreshed '${serverName}' tools in background (${Object.keys(tools).length})`)
                }
            } catch (err) {
                if (this.shouldLog) {
                    console.error(`[MCP] Failed to refresh server '${serverName}':`, err)
                }
            }
        })()

        this.refreshPromises.set(serverName, task)
        task.finally(() => {
            this.refreshPromises.delete(serverName)
        })

        if (mode === 'sync') {
            await task
        }
    }

    private removeToolsForMissingServers(activeServerNames: Set<string>) {
        for (const [serverName, toolNames] of this.serverToolNames.entries()) {
            if (activeServerNames.has(serverName)) continue
            for (const toolName of toolNames) {
                this.tools.delete(toolName)
            }
            this.serverToolNames.delete(serverName)
        }
    }

    /**
     * Connect and load all configured MCP Servers
     * @param servers - mapping from server names to configurations
     * @returns number of successfully loaded tools
     */
    async loadServers(servers: Record<string, MCPServerConfig> | undefined): Promise<number> {
        return this.loadServersWithOptions(servers)
    }

    async loadServersWithOptions(
        servers: Record<string, MCPServerConfig> | undefined,
        oauthSettings?: McpOAuthSettings,
    ): Promise<number> {
        if (!servers || Object.keys(servers).length === 0) {
            return 0
        }

        const entries = Object.entries(servers)
        this.pool.setServerConfigs(servers, oauthSettings)
        this.removeToolsForMissingServers(new Set(entries.map(([name]) => name)))

        const syncRefreshTasks: Promise<void>[] = []

        for (const [serverName, config] of entries) {
            const cached = await this.cacheStore.getServerTools(serverName, config)
            if (cached) {
                const tools = Object.fromEntries(
                    cached.tools.map((descriptor) => [
                        `${serverName}_${descriptor.originalName}`,
                        this.buildCachedTool(serverName, config, descriptor),
                    ]),
                )
                this.replaceServerTools(serverName, tools)
                if (this.shouldLog) {
                    console.log(
                        `[MCP] Loaded ${Object.keys(tools).length} cached tools for '${serverName}' (${cached.stale ? 'stale' : 'fresh'})`,
                    )
                }

                if (cached.stale) {
                    void this.refreshServer(serverName, config, 'background')
                }
                continue
            }

            syncRefreshTasks.push(this.refreshServer(serverName, config, 'sync'))
        }

        await Promise.all(syncRefreshTasks)
        return this.tools.size
    }

    /** Get tool */
    get(name: string): Tool | undefined {
        return this.tools.get(name)
    }

    /** Get all tools */
    getAll(): Tool[] {
        return Array.from(this.tools.values())
    }

    /** Convert to AI SDK ToolSet format */
    toToolSet(): Record<string, Tool> {
        return Object.fromEntries(this.tools)
    }

    /** Check if tool exists */
    has(name: string): boolean {
        return this.tools.has(name)
    }

    /** Get tool count */
    get size(): number {
        return this.tools.size
    }

    /** Close all MCP connections */
    async dispose(): Promise<void> {
        await this.pool.closeAll()
        this.tools.clear()
        this.serverToolNames.clear()
        this.refreshPromises.clear()
        setActiveMcpPool(null)
        setActiveMcpCacheStore(null)
    }

    /** Get internal pool (for testing or advanced usage) */
    getPool(): McpClientPool {
        return this.pool
    }
}
