/** @file 外部 MCP Server 客户端封装，负责加载远程工具列表。 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpTool } from '@memo/tools/tools/types'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { MCPServerConfig } from '../config/config'
import { z } from 'zod'
import { join } from 'node:path'
import { homedir } from 'node:os'

type SerializedMcpTool = {
    name: string
    description: string
    inputSchema: any
}

type McpCacheEntry = {
    tools: SerializedMcpTool[]
    cached_at: string
    config_hash: string
}

type McpCache = {
    servers: Record<string, McpCacheEntry>
}

type ClientTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

const MCP_CACHE_FILE = join(homedir(), '.memo', 'mcp_cache.json')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时

function hashConfig(config: MCPServerConfig): string {
    return JSON.stringify(config)
}

function createMemoClient() {
    return new Client(
        {
            name: 'memo-cli-client',
            version: '1.0.0',
        },
        {
            capabilities: {},
        },
    )
}

function buildRequestInit(headers?: Record<string, string>) {
    if (!headers || Object.keys(headers).length === 0) return undefined
    return { headers }
}

async function connectOverHttp(
    conf: Extract<MCPServerConfig, { url: string }>,
): Promise<{ client: Client; transport: ClientTransport }> {
    const baseUrl = new URL(conf.url)
    const requestInit = buildRequestInit(conf.headers)

    if (conf.type === 'sse') {
        const client = createMemoClient()
        const transport = new SSEClientTransport(baseUrl, { requestInit })
        await client.connect(transport)
        return { client, transport }
    }

    const allowFallback = conf.fallback_to_sse ?? true
    try {
        const client = createMemoClient()
        const transport = new StreamableHTTPClientTransport(baseUrl, { requestInit })
        await client.connect(transport)
        return { client, transport }
    } catch (streamErr) {
        if (!allowFallback) throw streamErr
        try {
            const client = createMemoClient()
            const transport = new SSEClientTransport(baseUrl, { requestInit })
            await client.connect(transport)
            return { client, transport }
        } catch (sseErr) {
            const message = `Failed to connect via streamable_http (${(streamErr as Error).message}); SSE fallback failed (${(sseErr as Error).message})`
            const combined = new Error(message)
            ;(combined as any).cause = { streamErr, sseErr }
            throw combined
        }
    }
}

async function connectWithConfig(
    config: MCPServerConfig,
): Promise<{ client: Client; transport: ClientTransport }> {
    if ('url' in config) {
        return connectOverHttp(config)
    }
    const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
    })
    const client = createMemoClient()
    await client.connect(transport)
    return { client, transport }
}

async function loadMcpCache(): Promise<McpCache> {
    try {
        const file = Bun.file(MCP_CACHE_FILE)
        if (await file.exists()) {
            const content = await file.text()
            return JSON.parse(content) as McpCache
        }
    } catch (err) {
        console.warn(`读取 MCP 缓存失败: ${(err as Error).message}`)
    }
    return { servers: {} }
}

async function saveMcpCache(cache: McpCache): Promise<void> {
    try {
        await Bun.write(MCP_CACHE_FILE, JSON.stringify(cache, null, 2))
    } catch (err) {
        console.warn(`写入 MCP 缓存失败: ${(err as Error).message}`)
    }
}

function isCacheValid(entry: McpCacheEntry): boolean {
    const cachedAt = new Date(entry.cached_at).getTime()
    const now = Date.now()
    return now - cachedAt < CACHE_TTL_MS
}

function deserializeTool(
    serverName: string,
    serialized: SerializedMcpTool,
    client: Client,
): McpTool {
    return {
        name: serialized.name,
        description: serialized.description,
        inputSchema: z.object({}).passthrough(),
        execute: async (input: any): Promise<CallToolResult> => {
            const originalName = serialized.name.replace(`${serverName}_`, '')
            const res = await client.callTool({
                name: originalName,
                arguments: input,
            })
            return res as CallToolResult
        },
        _rawJSONSchema: serialized.inputSchema,
    } as unknown as McpTool
}

/**
 * 管理与外部 MCP Server 的连接。
 */
export class McpClientWrapper {
    public client: Client
    private transport?: ClientTransport

    constructor(
        public name: string,
        private config: MCPServerConfig,
    ) {
        this.client = createMemoClient()
    }

    async connect() {
        const { client, transport } = await connectWithConfig(this.config)
        this.client = client
        this.transport = transport
    }

    async listTools(): Promise<McpTool[]> {
        const result = await this.client.listTools()
        const tools = result.tools || []

        return tools.map((t) => {
            const toolName = `${this.name}_${t.name}`
            return {
                name: toolName,
                description: t.description || `Tool from ${this.name}: ${t.name}`,
                // 本地校验使用 passthrough schema，因为我们信任 server 端校验，或者仅仅是做转发。
                // 实际给 Agent Prompt 的 schema 需要单独注入。
                inputSchema: z.object({}).passthrough(),
                execute: async (input: any): Promise<CallToolResult> => {
                    const res = await this.client.callTool({
                        name: t.name,
                        arguments: input,
                    })
                    return res as CallToolResult
                },
                // 标记字段，用于 Prompt 生成器识别这是一个动态工具并获取原始 JSON Schema
                _rawJSONSchema: t.inputSchema,
            } as unknown as McpTool
        })
    }

    serializeTools(tools: McpTool[]): SerializedMcpTool[] {
        return tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: (t as any)._rawJSONSchema,
        }))
    }

    async close() {
        try {
            await this.client.close()
        } catch (e) {
            console.error(`Error closing MCP client ${this.name}:`, e)
        }
    }
}

/**
 * 连接所有配置的 MCP Server（优先从缓存加载，后台异步更新）。
 * 返回工具列表和一个清理函数。
 */
export async function loadExternalMcpTools(
    servers: Record<string, MCPServerConfig> | undefined,
): Promise<{ tools: McpTool[]; cleanup: () => Promise<void> }> {
    if (!servers || Object.keys(servers).length === 0) {
        return { tools: [], cleanup: async () => {} }
    }

    const cache = await loadMcpCache()
    const wrappers: McpClientWrapper[] = []
    const allTools: McpTool[] = []
    const needsUpdate: Array<{ name: string; config: MCPServerConfig; wrapper: McpClientWrapper }> =
        []

    // 并行处理所有 server
    await Promise.all(
        Object.entries(servers).map(async ([name, config]) => {
            try {
                const configHash = hashConfig(config)
                const cached = cache.servers[name]
                const serverStartTime = performance.now()

                // 先连接（所有情况都需要）
                const wrapper = new McpClientWrapper(name, config)
                await wrapper.connect()
                const connectTime = performance.now()
                wrappers.push(wrapper)

                // 检查缓存是否有效
                if (cached && cached.config_hash === configHash && isCacheValid(cached)) {
                    // 反序列化缓存的工具
                    const tools = cached.tools.map((t) => deserializeTool(name, t, wrapper.client))
                    allTools.push(...tools)
                } else {
                    const tools = await wrapper.listTools()
                    allTools.push(...tools)

                    // 立即更新缓存
                    const serialized = wrapper.serializeTools(tools)
                    cache.servers[name] = {
                        tools: serialized,
                        cached_at: new Date().toISOString(),
                        config_hash: configHash,
                    }
                    needsUpdate.push({ name, config, wrapper })
                }
            } catch (err) {
                console.error(`[MCP] Failed to connect to server '${name}':`, err)
            }
        }),
    )

    // 持久化更新的缓存
    if (needsUpdate.length > 0) {
        await saveMcpCache(cache)
    }

    return {
        tools: allTools,
        cleanup: async () => {
            await Promise.all(wrappers.map((w) => w.close()))
        },
    }
}
