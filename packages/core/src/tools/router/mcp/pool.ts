/** @file MCP Client 连接池管理（基于 @ai-sdk/mcp） */
import { createMCPClient, UnauthorizedError, type MCPClient, type MCPClientConfig } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import type { MCPServerConfig, McpClientConnection } from '../types'
import { createRuntimeMcpOAuthProvider, type McpOAuthSettings } from './oauth'

function mergeProcessEnv(env?: Record<string, string>): Record<string, string> | undefined {
    if (!env) return undefined
    const merged: Record<string, string | undefined> = {
        ...process.env,
        ...env,
    }
    const entries = Object.entries(merged).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    return Object.fromEntries(entries)
}

function resolveHttpHeaders(config: Extract<MCPServerConfig, { url: string }>) {
    const headers = {
        ...(config.http_headers ?? config.headers),
    }
    if (config.bearer_token_env_var) {
        const token = process.env[config.bearer_token_env_var]
        if (token && !headers.Authorization) {
            headers.Authorization = `Bearer ${token}`
        }
    }
    return headers
}

/** 根据配置建立 AI SDK MCP 客户端 */
async function connectWithConfig(
    name: string,
    config: MCPServerConfig,
    oauthSettings: McpOAuthSettings | undefined,
): Promise<MCPClient> {
    if ('url' in config) {
        const authProvider = await createRuntimeMcpOAuthProvider({
            serverName: name,
            config,
            settings: oauthSettings,
        })
        const transport: MCPClientConfig['transport'] = {
            type: 'http',
            url: config.url,
            headers: resolveHttpHeaders(config),
            ...(authProvider ? { authProvider } : {}),
        }
        try {
            return await createMCPClient({ transport })
        } catch (streamErr) {
            const authHint = isAuthFailure(streamErr) ? ` Run "memo mcp login ${name}".` : ''
            const message = `Failed to connect via streamable_http (${(streamErr as Error).message}).${authHint}`
            const error = new Error(message)
            ;(error as any).cause = streamErr
            throw error
        }
    }

    // stdio 类型
    const transport = new Experimental_StdioMCPTransport({
        command: config.command,
        args: config.args,
        env: mergeProcessEnv(config.env),
        stderr: config.stderr ?? (process.stdout.isTTY && process.stdin.isTTY ? 'ignore' : undefined),
    })
    return createMCPClient({ transport })
}

/** MCP Client 连接池 */
export class McpClientPool {
    private connections: Map<string, McpClientConnection> = new Map()
    private pendingConnections: Map<string, Promise<McpClientConnection>> = new Map()
    private serverConfigs: Map<string, MCPServerConfig> = new Map()
    private oauthSettings: McpOAuthSettings | undefined

    setServerConfigs(servers: Record<string, MCPServerConfig>, oauthSettings?: McpOAuthSettings) {
        this.serverConfigs = new Map(Object.entries(servers))
        this.oauthSettings = oauthSettings
    }

    hasServer(name: string): boolean {
        return this.connections.has(name) || this.serverConfigs.has(name)
    }

    /**
     * Connect to specified MCP Server
     * @param name - server name (key in configuration)
     * @param config - server configuration
     * @returns connection info (AI SDK MCP client + tool set)
     */
    async connect(name: string, config?: MCPServerConfig): Promise<McpClientConnection> {
        if (config) {
            this.serverConfigs.set(name, config)
        }

        // If already connected, return directly
        const existing = this.connections.get(name)
        if (existing) {
            return existing
        }

        const inflight = this.pendingConnections.get(name)
        if (inflight) {
            return inflight
        }

        const effectiveConfig = config ?? this.serverConfigs.get(name)
        if (!effectiveConfig) {
            throw new Error(`MCP server config not found: ${name}`)
        }

        const pending = (async () => {
            const client = await connectWithConfig(name, effectiveConfig, this.oauthSettings)

            try {
                // Get tool set (AI SDK Tools with own execute).
                const tools = await client.tools()
                const connection: McpClientConnection = {
                    name,
                    client,
                    tools,
                }

                this.connections.set(name, connection)
                return connection
            } catch (err) {
                try {
                    await client.close()
                } catch {
                    // Ignore close errors when bootstrap fails.
                }
                throw err
            }
        })()

        this.pendingConnections.set(name, pending)
        try {
            return await pending
        } finally {
            this.pendingConnections.delete(name)
        }
    }

    /** Get connected client */
    get(name: string): McpClientConnection | undefined {
        return this.connections.get(name)
    }

    /** Get all connections */
    getAll(): McpClientConnection[] {
        return Array.from(this.connections.values())
    }

    getKnownServerNames(): string[] {
        const names = new Set<string>([
            ...Array.from(this.serverConfigs.keys()),
            ...Array.from(this.connections.keys()),
        ])
        return Array.from(names.values())
    }

    /** Get all tools (across all connections) */
    getAllTools() {
        const allTools: {
            name: string
            description: string
            serverName: string
            originalName: string
            inputSchema: unknown
            client: MCPClient
        }[] = []

        for (const conn of this.connections.values()) {
            for (const [originalName, tool] of Object.entries(conn.tools)) {
                allTools.push({
                    name: `${conn.name}_${originalName}`,
                    description: tool.description ?? `Tool from ${conn.name}: ${originalName}`,
                    serverName: conn.name,
                    originalName,
                    inputSchema: (tool.inputSchema as { jsonSchema?: () => unknown }).jsonSchema?.(),
                    client: conn.client,
                })
            }
        }

        return allTools
    }

    /** Close all connections */
    async closeAll(): Promise<void> {
        const closePromises = Array.from(this.connections.values()).map(async (conn) => {
            try {
                await conn.client.close()
            } catch (err) {
                console.error(`[MCP] Error closing client ${conn.name}:`, err)
            }
        })

        await Promise.all(closePromises)
        this.connections.clear()
        this.pendingConnections.clear()
    }

    /** Get connection count */
    get size(): number {
        return this.connections.size
    }
}

function isAuthFailure(error: unknown): boolean {
    if (error instanceof UnauthorizedError) return true
    const message = (error as Error)?.message?.toLowerCase() ?? ''
    return (
        message.includes('unauthorized') ||
        message.includes('401') ||
        message.includes('403') ||
        message.includes('oauth')
    )
}
