/** @file MCP Client 连接池管理 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { MCPServerConfig, McpClientConnection } from '../types'
import { createRuntimeMcpOAuthProvider, type McpOAuthSettings } from './oauth'

type ClientTransport = StdioClientTransport | StreamableHTTPClientTransport

function mergeProcessEnv(env?: Record<string, string>): Record<string, string> | undefined {
    if (!env) return undefined
    const merged: Record<string, string | undefined> = {
        ...process.env,
        ...env,
    }
    const entries = Object.entries(merged).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    return Object.fromEntries(entries)
}

/** 创建标准化的 MCP Client */
function createMcpClient(): Client {
    return new Client(
        {
            name: 'memo-code-cli-client',
            version: '1.0.0',
        },
        {
            capabilities: {},
        },
    )
}

/** 构建 HTTP 请求的 headers */
function buildRequestInit(headers?: Record<string, string>): RequestInit | undefined {
    if (!headers || Object.keys(headers).length === 0) return undefined
    return { headers }
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

/** 通过 HTTP 连接 MCP Server */
async function connectOverHttp(
    name: string,
    config: Extract<MCPServerConfig, { url: string }>,
    oauthSettings: McpOAuthSettings | undefined,
): Promise<{ client: Client; transport: ClientTransport }> {
    const baseUrl = new URL(config.url)
    const requestInit = buildRequestInit(resolveHttpHeaders(config))
    const authProvider = await createRuntimeMcpOAuthProvider({
        serverName: name,
        config,
        settings: oauthSettings,
    })

    try {
        const client = createMcpClient()
        const transport = new StreamableHTTPClientTransport(baseUrl, {
            requestInit,
            ...(authProvider ? { authProvider } : {}),
        })
        await client.connect(transport)
        return { client, transport }
    } catch (streamErr) {
        const authHint = isAuthFailure(streamErr) ? ` Run "memo mcp login ${name}".` : ''
        const message = `Failed to connect via streamable_http (${(streamErr as Error).message}).${authHint}`
        const error = new Error(message)
        ;(error as any).cause = streamErr
        throw error
    }
}

/** 根据配置建立连接 */
async function connectWithConfig(
    name: string,
    config: MCPServerConfig,
    oauthSettings: McpOAuthSettings | undefined,
): Promise<{ client: Client; transport: ClientTransport }> {
    if ('url' in config) {
        return connectOverHttp(name, config, oauthSettings)
    }

    // stdio 类型
    const stdioOptions: {
        command: string
        args?: string[]
        env?: Record<string, string>
        stderr?: 'inherit' | 'pipe' | 'ignore'
    } = {
        command: config.command,
        args: config.args,
        env: mergeProcessEnv(config.env),
        stderr: config.stderr ?? (process.stdout.isTTY && process.stdin.isTTY ? 'ignore' : undefined),
    }
    const transport = new StdioClientTransport(stdioOptions as any)
    const client = createMcpClient()
    await client.connect(transport)
    return { client, transport }
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
     * @returns connection info (contains client, transport, and tool list)
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
            // Establish new connection
            const { client, transport } = await connectWithConfig(name, effectiveConfig, this.oauthSettings)

            try {
                // Get tool list
                const toolsResult = await client.listTools()

                // Build McpTool array (execute not filled yet, handled by Registry)
                const connection: McpClientConnection = {
                    name,
                    client,
                    transport,
                    tools: (toolsResult.tools || []).map((t) => ({
                        name: `${name}_${t.name}`,
                        description: t.description || `Tool from ${name}: ${t.name}`,
                        source: 'mcp' as const,
                        serverName: name,
                        originalName: t.name,
                        inputSchema: t.inputSchema as any,
                        // execute 会在 registry 中绑定
                        execute: async () => ({ type: 'text', value: '' }),
                    })),
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
            inputSchema: any
            client: Client
        }[] = []

        for (const conn of this.connections.values()) {
            for (const tool of conn.tools) {
                allTools.push({
                    name: tool.name,
                    description: tool.description,
                    serverName: tool.serverName,
                    originalName: tool.originalName,
                    inputSchema: tool.inputSchema,
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
    if (error instanceof StreamableHTTPError) {
        return error.code === 401 || error.code === 403
    }
    const message = (error as Error)?.message?.toLowerCase() ?? ''
    return (
        message.includes('unauthorized') ||
        message.includes('401') ||
        message.includes('403') ||
        message.includes('oauth')
    )
}
