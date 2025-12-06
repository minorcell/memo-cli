/**
 * Agent 层的基础类型声明，涵盖对话消息、解析结果与依赖注入接口。
 * 每个类型尽量保持精简，方便在 UI/工具等层复用。
 */
export type Role = "system" | "user" | "assistant"

/** 模型侧的单条聊天消息。 */
export type ChatMessage = {
    role: Role
    content: string
}

/** Agent 运行得到的结果，包括最终答案与全量日志。 */
export type AgentResult = {
    answer: string
    logEntries: string[]
}

/** 单步调试记录。 */
export type AgentStepTrace = {
    index: number
    assistantText: string
    parsed: ParsedAssistant
    observation?: string
    tokenUsage: TokenUsage
}

/** token 统计数据，提示词/生成/总计。 */
export type TokenUsage = {
    prompt: number
    completion: number
    total: number
}

/** 统一的 tokenizer 计数器接口。 */
export type TokenCounter = {
    model: string
    countText: (text: string) => number
    countMessages: (messages: ChatMessage[]) => number
    dispose: () => void
}

/** LLM 响应（兼容仅文本或携带 usage 的返回）。 */
export type LLMResponse =
    | string
    | {
          content: string
          usage?: Partial<TokenUsage>
      }

/** 将 LLM 输出解析成 action/final 结构后的表示。 */
export type ParsedAssistant = {
    action?: { tool: string; input: string }
    final?: string
}

/** 单个工具函数签名：输入字符串，返回字符串结果。 */
export type ToolFn = (input: string) => Promise<string>
/** 工具注册表，键为工具名称，值为执行函数。 */
export type ToolRegistry = Record<string, ToolFn>

/** LLM 调用接口：输入历史消息，返回模型回复文本。 */
export type CallLLM = (messages: ChatMessage[]) => Promise<LLMResponse>

/**
 * runAgent 运行所需的依赖注入集合。
 * - tools: 可用的工具集合。
 * - callLLM: 具体的模型调用函数。
 * - loadPrompt: 自定义加载系统提示词。
 * - onAssistantStep: 每轮模型输出的回调（便于流式打印）。
 */
export type AgentDeps = {
    tools: ToolRegistry
    callLLM: CallLLM
    loadPrompt?: () => Promise<string>
    onAssistantStep?: (content: string, step: number) => void
}

/** Session 模式：一次性或交互式。 */
export type SessionMode = "interactive" | "once"

/** Session 级别的配置项。 */
export type AgentSessionOptions = {
    sessionId?: string
    mode?: SessionMode
    tokenizerModel?: string
    warnPromptTokens?: number
    maxPromptTokens?: number
}

/** Session 运行需要的依赖（含扩展项）。 */
export type AgentSessionDeps = AgentDeps & {
    historySinks?: HistorySink[]
    tokenCounter?: TokenCounter
}

export type TurnStatus = "ok" | "error" | "max_steps" | "prompt_limit"

export type TurnResult = {
    finalText: string
    steps: AgentStepTrace[]
    status: TurnStatus
    errorMessage?: string
    tokenUsage: TokenUsage
    logEntries: string[]
}

export type AgentSession = {
    id: string
    mode: SessionMode
    history: ChatMessage[]
    runTurn: (input: string) => Promise<TurnResult>
    close: () => Promise<void>
}

/** 日志事件类型，用于 JSONL。 */
export type HistoryEventType =
    | "session_start"
    | "session_end"
    | "turn_start"
    | "assistant"
    | "action"
    | "observation"
    | "final"
    | "turn_end"

/** 结构化历史事件，便于 JSONL 序列化。 */
export type HistoryEvent = {
    ts: string
    sessionId: string
    turn?: number
    step?: number
    type: HistoryEventType
    content?: string
    role?: Role
    meta?: Record<string, unknown>
}

/** 历史落盘抽象，可输出到文件/外部系统。 */
export type HistorySink = {
    append: (event: HistoryEvent) => Promise<void> | void
    flush?: () => Promise<void> | void
}
