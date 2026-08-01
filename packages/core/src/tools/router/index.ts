/** @file ToolRouter - 统一工具路由管理
 *
 * 职责：
 * 1. 管理内置工具（NativeToolRegistry）
 * 2. 管理外部 MCP 工具（McpToolRegistry）
 * 3. 提供统一的工具查询和执行接口
 * 4. 生成工具描述（用于 Prompt）
 */
import type { MemoToolOutput, Tool, ToolRegistry, MCPServerConfig, ToolDescription } from './types'
import { NativeToolRegistry } from './native'
import { McpToolRegistry } from './mcp'
import type { McpOAuthSettings } from './mcp/oauth'

export type { Tool, ToolRegistry, MCPServerConfig, ToolDescription, NativeTool, McpTool } from './types'
export { NativeToolRegistry, McpToolRegistry }
export type { McpOAuthSettings } from './mcp/oauth'

/** 工具路由管理器 */
export class ToolRouter {
    private nativeRegistry: NativeToolRegistry
    private mcpRegistry: McpToolRegistry

    constructor() {
        this.nativeRegistry = new NativeToolRegistry()
        this.mcpRegistry = new McpToolRegistry()
    }

    // ==================== 注册方法 ====================

    /** 注册内置工具 */
    registerNativeTool(tool: Tool): void {
        this.nativeRegistry.register(tool as import('./types').NativeTool)
    }

    /** 批量注册内置工具 */
    registerNativeTools(tools: Tool[]): void {
        for (const tool of tools) {
            this.registerNativeTool(tool)
        }
    }

    /** 连接并加载 MCP Servers */
    async loadMcpServers(
        servers: Record<string, MCPServerConfig> | undefined,
        oauthSettings?: McpOAuthSettings,
    ): Promise<number> {
        return this.mcpRegistry.loadServersWithOptions(servers, oauthSettings)
    }

    // ==================== 查询方法 ====================

    /** 获取指定工具（优先 native，然后 mcp） */
    getTool(name: string): Tool | undefined {
        return this.nativeRegistry.get(name) ?? this.mcpRegistry.get(name)
    }

    /** 获取所有工具 */
    getAllTools(): Tool[] {
        return [...this.nativeRegistry.getAll(), ...this.mcpRegistry.getAll()]
    }

    /** 获取工具注册表格式 */
    toRegistry(): ToolRegistry {
        return {
            ...this.nativeRegistry.toRegistry(),
            ...this.mcpRegistry.toRegistry(),
        }
    }

    /** 检查工具是否存在 */
    hasTool(name: string): boolean {
        return this.nativeRegistry.has(name) || this.mcpRegistry.has(name)
    }

    /** 获取工具总数 */
    getToolCount(): { native: number; mcp: number; total: number } {
        const native = this.nativeRegistry.size
        const mcp = this.mcpRegistry.size
        return { native, mcp, total: native + mcp }
    }

    // ==================== 执行方法 ====================

    /**
     * 执行指定工具
     * @param name - 工具名称
     * @param input - 工具输入参数
     * @returns 工具执行结果
     * @throws 如果工具不存在
     */
    async execute(name: string, input: unknown): Promise<MemoToolOutput> {
        const tool = this.getTool(name)
        if (!tool) {
            throw new Error(`Tool '${name}' not found`)
        }
        return tool.execute(input)
    }

    // ==================== Prompt 生成 ====================

    /**
     * 生成 Tool Use API 格式的工具定义列表
     * @returns 工具定义数组，用于传递给 LLM API
     */

    /**
     * 生成工具描述文本，用于注入到系统 Prompt
     * @returns 格式化的工具描述
     */
    generateToolDescriptions(): string {
        const tools = this.getAllTools()
        if (tools.length === 0) {
            return ''
        }

        const lines: string[] = []
        lines.push('## Available Tools')
        lines.push('')

        // 分组：内置工具和 MCP 工具
        const nativeTools = tools.filter((t) => t.source === 'native')
        const mcpTools = tools.filter((t) => t.source === 'mcp')

        // 内置工具
        if (nativeTools.length > 0) {
            lines.push('### Built-in Tools')
            lines.push('')
            for (const tool of nativeTools) {
                lines.push(this.formatToolDescription(tool))
            }
            lines.push('')
        }

        // MCP tools
        if (mcpTools.length > 0) {
            lines.push('### External MCP Tools')
            lines.push('')

            // Group by server
            const grouped = this.groupByServer(mcpTools)
            for (const [serverName, serverTools] of Object.entries(grouped)) {
                lines.push(`**Server: ${serverName}**`)
                lines.push('')
                for (const tool of serverTools) {
                    lines.push(this.formatToolDescription(tool))
                }
                lines.push('')
            }
        }

        return lines.join('\n')
    }

    /** Format single tool description */
    private formatToolDescription(tool: Tool): string {
        const lines: string[] = []
        lines.push(`#### ${tool.name}`)
        lines.push(`- **Description**: ${tool.description}`)

        if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
            lines.push(`- **Input Schema**: ${JSON.stringify(tool.inputSchema)}`)
        }

        return lines.join('\n')
    }

    /** Group MCP tools by server */
    private groupByServer(tools: Tool[]): Record<string, Tool[]> {
        const grouped: Record<string, Tool[]> = {}
        for (const tool of tools) {
            if (tool.source === 'mcp') {
                const serverName = (tool as import('./types').McpTool).serverName
                if (!grouped[serverName]) {
                    grouped[serverName] = []
                }
                grouped[serverName].push(tool)
            }
        }
        return grouped
    }

    /**
     * 获取工具描述列表（结构化数据）
     */
    getToolDescriptions(): ToolDescription[] {
        return this.getAllTools().map((tool) => ({
            name: tool.name,
            description: tool.description,
            source: tool.source,
            serverName: tool.source === 'mcp' ? (tool as import('./types').McpTool).serverName : undefined,
            inputSchema: tool.inputSchema,
        }))
    }

    // ==================== 生命周期 ====================

    /** 清理资源（关闭 MCP 连接等） */
    async dispose(): Promise<void> {
        await this.mcpRegistry.dispose()
    }
}

/** 创建并初始化 ToolRouter（便捷函数） */
export async function createToolRouter(options: {
    nativeTools?: Tool[]
    mcpServers?: Record<string, MCPServerConfig>
    mcpOAuthSettings?: McpOAuthSettings
}): Promise<ToolRouter> {
    const router = new ToolRouter()

    // 注册内置工具
    if (options.nativeTools && options.nativeTools.length > 0) {
        router.registerNativeTools(options.nativeTools)
    }

    // 加载 MCP Servers
    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
        await router.loadMcpServers(options.mcpServers, options.mcpOAuthSettings)
    }

    return router
}
