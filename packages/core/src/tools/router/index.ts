/** @file ToolRouter - 统一工具路由管理
 *
 * 职责：
 * 1. 管理内置工具（NativeToolRegistry）
 * 2. 管理外部 MCP 工具（McpToolRegistry）
 * 3. 提供统一的工具查询和执行接口
 */
import type { MemoToolOutput, Tool, ToolRegistry, MCPServerConfig } from './types'
import { NativeToolRegistry } from './native'
import { McpToolRegistry } from './mcp'
import type { McpOAuthSettings } from './mcp/oauth'

export type { Tool, ToolRegistry, MCPServerConfig, NativeTool, McpTool } from './types'
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
