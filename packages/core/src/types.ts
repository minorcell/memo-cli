import type { McpTool } from '@memo/tools/tools/types'

/**
 * Agent 层的基础类型声明，涵盖对话消息、解析结果与依赖注入接口。
 * 每个类型尽量保持精简，方便在 UI/工具等层复用。
 */
export type Role = 'system' | 'user' | 'assistant'

/** 模型侧的单条聊天消息（OpenAI 兼容）。 */
export type ChatMessage = {
    /** 消息角色：system/user/assistant。 */
    role: Role
    /** 消息正文。 */
    content: string
}

/** 单步调试记录，便于回放与可观测。 */
export type AgentStepTrace = {
    /** 步骤索引，从 0 开始。 */
    index: number
    /** 本步 assistant 的原始输出。 */
    assistantText: string
    /** 解析后的 action/final 结构。 */
    parsed: ParsedAssistant
    /** 本步对应的工具 observation（若有）。 */
    observation?: string
    /** 本步的 token 统计。 */
    tokenUsage: TokenUsage
}

/** token 统计数据，提示词/生成/总计。 */
export type TokenUsage = {
    /** 输入提示词占用的 tokens。 */
    prompt: number
    /** 模型生成部分的 tokens。 */
    completion: number
    /** 总 tokens（若模型未返回，则为 prompt+completion）。 */
    total: number
}

/** 统一的 tokenizer 计数器接口，兼容不同模型的 encoding。 */
export type TokenCounter = {
    /** 实际使用的 tokenizer/encoding 名称。 */
    model: string
    /** 计算纯文本的 tokens。 */
    countText: (text: string) => number
    /** 计算消息数组的 tokens。 */
    countMessages: (messages: ChatMessage[]) => number
    /** 释放底层资源。 */
    dispose: () => void
}

/** LLM 响应（兼容仅文本或携带 usage 的返回）。 */
export type LLMResponse =
    | string
    | {
          /** 模型输出文本。 */
          content: string
          /** 模型返回的 token usage（可选）。 */
          usage?: Partial<TokenUsage>
          /** 若为流式增量输出，标记已通过 onChunk 传递过部分内容。 */
          streamed?: boolean
      }

/** 将 LLM 输出解析成 action/final 结构后的表示。 */
export type ParsedAssistant = {
    /** 待调用的工具及其入参。 */
    action?: { tool: string; input: unknown }
    /** 最终回答。 */
    final?: string
}

/** 工具注册表，键为工具名称，值为 MCP 工具定义。 */
export type ToolRegistry = Record<string, McpTool<any>>

/** LLM 调用接口：输入历史消息，返回模型回复文本或携带 usage，可选流式回调。 */
export type CallLLM = (messages: ChatMessage[], onChunk?: (chunk: string) => void) => Promise<LLMResponse>

/**
 * runAgent 运行所需的依赖注入集合。
 * - tools: 可用的工具集合。
 * - callLLM: 具体的模型调用函数。
 * - loadPrompt: 自定义加载系统提示词。
 * - onAssistantStep: 每轮模型输出的回调（便于流式打印）。
 */
export type AgentDeps = {
    /** 工具名称到实现的映射（未提供则使用默认工具集）。 */
    tools?: ToolRegistry
    /** 模型调用实现。 */
    callLLM?: CallLLM
    /** 系统提示词加载（不提供则用默认内置）。 */
    loadPrompt?: () => Promise<string>
    /** 每次 assistant 输出时的回调。 */
    onAssistantStep?: (content: string, step: number) => void
    /** 每次工具 observation 返回时的回调。 */
    onObservation?: (tool: string, observation: string, step: number) => void
}

/** Session 模式：一次性或交互式。 */
export type SessionMode = 'interactive' | 'once'

/** Session 级别的配置项。 */
export type AgentSessionOptions = {
    /** 自定义 Session ID（默认随机）。 */
    sessionId?: string
    /** 运行模式：交互式/单次。 */
    mode?: SessionMode
    /** 历史 JSONL 输出目录（默认 history/）。 */
    historyDir?: string
    /** 指定使用的 provider 名称。 */
    providerName?: string
    /** 每个 turn 内的最大 step 数。 */
    maxSteps?: number
    /** tokenizer encoding 名称，默认 cl100k_base。 */
    tokenizerModel?: string
    /** 提示词预警阈值。 */
    warnPromptTokens?: number
    /** 提示词硬上限，超出直接拒绝。 */
    maxPromptTokens?: number
    /** 是否启用 LLM 流式输出。 */
    stream?: boolean
}

/** Session 运行需要的依赖（含扩展项）。 */
export type AgentSessionDeps = AgentDeps & {
    /** 历史事件 sink 列表（JSONL 等）。 */
    historySinks?: HistorySink[]
    /** 自定义 tokenizer。 */
    tokenCounter?: TokenCounter
}

/** 单轮对话的状态码。 */
export type TurnStatus = 'ok' | 'error' | 'max_steps' | 'prompt_limit'

/** 单轮对话的运行结果（含步骤与 token）。 */
export type TurnResult = {
    /** 最终输出文本。 */
    finalText: string
    /** 步骤轨迹。 */
    steps: AgentStepTrace[]
    /** 运行状态。 */
    status: TurnStatus
    /** 错误信息（若有）。 */
    errorMessage?: string
    /** 本轮 token 统计。 */
    tokenUsage: TokenUsage
}

/** Session 对象，持有历史并可执行多轮对话。 */
export type AgentSession = {
    /** Session 唯一标识。 */
    id: string
    /** 运行模式。 */
    mode: SessionMode
    /** 当前对话历史。 */
    history: ChatMessage[]
    /** 执行一轮对话。 */
    runTurn: (input: string) => Promise<TurnResult>
    /** 结束 Session，释放资源。 */
    close: () => Promise<void>
}

/** 日志事件类型，用于 JSONL。 */
export type HistoryEventType =
    | 'session_start'
    | 'session_end'
    | 'turn_start'
    | 'assistant'
    | 'action'
    | 'observation'
    | 'final'
    | 'turn_end'

/** 结构化历史事件，便于 JSONL 序列化。 */
export type HistoryEvent = {
    ts: string
    sessionId: string
    turn?: number
    step?: number
    type: HistoryEventType
    /** 事件内容（如 assistant 文本、observation）。 */
    content?: string
    /** 角色（若适用）。 */
    role?: Role
    /** 额外元数据（工具名、token 等）。 */
    meta?: Record<string, unknown>
}

/** 历史落盘抽象，可输出到文件/外部系统。 */
export type HistorySink = {
    /** 写入单条事件。 */
    append: (event: HistoryEvent) => Promise<void> | void
    /** 可选：flush 持久化。 */
    flush?: () => Promise<void> | void
}
