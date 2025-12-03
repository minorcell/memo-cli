// 类型定义：模型消息、工具声明、Agent 结果等

export type DeepSeekMessage = { content?: string }

export type DeepSeekChoice = { message?: DeepSeekMessage }

export type DeepSeekResponse = { choices?: DeepSeekChoice[] }

export type Role = "system" | "user" | "assistant"

export type ChatMessage = {
    role: Role
    content: string
}

export type AgentResult = {
    answer: string
    logEntries: string[]
}

// 工具类型
export type ToolName = "bash" | "read" | "write" | "getTime" | "fetch"

export type ToolFn = (input: string) => Promise<string>

export type WriteMode = "append" | "overwrite"

export type WriteParseResult =
    | { error: string }
    | { path: string; content: string; mode: WriteMode }

export type ParsedAssistant = {
    action?: { tool: string; input: string }
    final?: string
}
