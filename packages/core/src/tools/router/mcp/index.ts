/** @file MCP tool registry */
import type { McpTool, MemoToolOutput, ToolRegistry, MCPServerConfig } from '../types'
import { McpClientPool } from './pool'
import { getGlobalMcpCacheStore, type CachedMcpToolDescriptor } from './cache_store'
import { setActiveMcpCacheStore, setActiveMcpPool } from './context'
import type { McpOAuthSettings } from './oauth'

/** MCP tool registry */
export class McpToolRegistry {
    private pool: McpClientPool
    private serverToolNames: Map<string, Set<string>> = new Map()
    private refreshPromises: Map<string, Promise<void>> = new Map()
    private tools: Map<string, McpTool> = new Map()
    private cacheStore = getGlobalMcpCacheStore()
    private readonly shouldLog: boolean

    constructor() {
        this.pool = new McpClientPool()
        setActiveMcpPool(this.pool)
        setActiveMcpCacheStore(this.cacheStore)
        this.shouldLog = !(process.stdout.isTTY && process.stdin.isTTY)
    }

    private buildTool(serverName: string, config: MCPServerConfig, descriptor: CachedMcpToolDescriptor): McpTool {
        return {
            name: `${serverName}_${descriptor.originalName}`,
            description: descriptor.description || `Tool from ${serverName}: ${descriptor.originalName}`,
            source: 'mcp',
            serverName,
            originalName: descriptor.originalName,
            inputSchema: (descriptor.inputSchema as any) ?? {},
            execute: async (input: unknown): Promise<MemoToolOutput> => {
                const connection = await this.pool.connect(serverName, config)
                const result = await connection.client.callTool({
                    name: descriptor.originalName,
                    arguments: input as Record<string, unknown>,
                })
                const callResult = result as unknown as {
                    content?: Array<{ type?: string; text?: string }>
                    isError?: boolean
                }
                const texts =
                    callResult.content?.flatMap((item) => (item.type === 'text' ? [item.text ?? ''] : [])) ?? []
                return result.isError
                    ? { type: 'error-text', value: texts.join('\n') || `Tool ${descriptor.originalName} failed` }
                    : { type: 'text', value: texts.join('\n') }
            },
        }
    }

    private replaceServerTools(serverName: string, nextTools: McpTool[]) {
        const prev = this.serverToolNames.get(serverName)
        if (prev) {
            for (const toolName of prev) {
                this.tools.delete(toolName)
            }
        }

        const next = new Set<string>()
        for (const tool of nextTools) {
            this.tools.set(tool.name, tool)
            next.add(tool.name)
        }
        this.serverToolNames.set(serverName, next)
    }

    private connectionToDescriptors(
        serverName: string,
        connection: Awaited<ReturnType<McpClientPool['connect']>>,
    ): CachedMcpToolDescriptor[] {
        return connection.tools.map((tool) => ({
            originalName: tool.originalName,
            description: tool.description || `Tool from ${serverName}: ${tool.originalName}`,
            inputSchema: tool.inputSchema,
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
                const tools = descriptors.map((descriptor) => this.buildTool(serverName, config, descriptor))
                this.replaceServerTools(serverName, tools)
                if (this.shouldLog && mode === 'background') {
                    console.log(`[MCP] Refreshed '${serverName}' tools in background (${tools.length})`)
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
                const tools = cached.tools.map((descriptor) => this.buildTool(serverName, config, descriptor))
                this.replaceServerTools(serverName, tools)
                if (this.shouldLog) {
                    console.log(
                        `[MCP] Loaded ${tools.length} cached tools for '${serverName}' (${cached.stale ? 'stale' : 'fresh'})`,
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
    get(name: string): McpTool | undefined {
        return this.tools.get(name)
    }

    /** Get all tools */
    getAll(): McpTool[] {
        return Array.from(this.tools.values())
    }

    /** Convert to ToolRegistry format */
    toRegistry(): ToolRegistry {
        const registry: ToolRegistry = {}
        for (const [name, tool] of this.tools) {
            registry[name] = tool
        }
        return registry
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
