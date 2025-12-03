export type ParsedAssistant = {
    action?: { tool: string; input: string }
    final?: string
}

/* Deepseek 消息类型 */

export type DeepSeekMessage = { content?: string }

export type DeepSeekChoice = { message?: DeepSeekMessage }

export type DeepSeekResponse = { choices?: DeepSeekChoice[] }

export type Role = "system" | "user" | "assistant"

export type ChatMessage = {
    role: Role
    content: string
}

/* 工具类型 */
export type ToolName = "bash" | "read" | "write" | "getTime" | "fetch"

export type ToolFn = (input: string) => Promise<string>

export type WriteMode = "append" | "overwrite"

export type WriteParseResult =
    | { error: string }
    | { path: string; content: string; mode: WriteMode }

/*  */

export type AgentResult = {
    answer: string
    logEntries: string[]
}