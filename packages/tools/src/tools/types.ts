import type { CallToolResult } from '@modelcontextprotocol/sdk/types'
import type { ZodTypeAny } from 'zod'

// 工具相关的类型声明

/** 工具名称枚举，作为 Agent action 中的 tool 字段。 */
export type ToolName =
    | 'bash'
    | 'read'
    | 'write'
    | 'edit'
    | 'glob'
    | 'grep'
    | 'webfetch'
    | 'save_memory'
    | 'todo'
    | 'run_bun'

/** MCP 工具定义，输入由 zod 校验，输出为 CallToolResult。 */
export type McpTool<Input = any> = {
    name: ToolName
    description: string
    inputSchema: ZodTypeAny
    execute: (input: Input) => Promise<CallToolResult>
}
