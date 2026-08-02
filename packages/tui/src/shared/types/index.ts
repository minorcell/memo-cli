import type { AgentStatus, LanguageModelUsage, TurnStatus } from '@memo/core'

export const TOOL_STATUS = {
    PENDING: 'pending',
    EXECUTING: 'executing',
    SUCCESS: 'success',
    ERROR: 'error',
} as const

export type ToolStatus = (typeof TOOL_STATUS)[keyof typeof TOOL_STATUS]

export type RuntimeStatus = 'idle' | 'running' | 'awaiting_approval' | 'cancelling' | 'compacting'

export type ToolAction = {
    toolCallId?: string
    tool: string
    input: unknown
}

export type ToolResultView = {
    toolCallId?: string
    tool: string
    observation: string
    status: ToolStatus
}

export type StepView = {
    index: number
    assistantText: string
    contextPromptTokens?: number
    /** Live thinking trace accumulated from streaming reasoning deltas. */
    streamingThinking?: string
    thinking?: string
    action?: ToolAction
    parallelActions?: ToolAction[]
    toolResults?: ToolResultView[]
    parallelToolStatuses?: ToolStatus[]
    observation?: string
    toolStatus?: ToolStatus
}

export type TurnView = {
    index: number
    userInput: string
    steps: StepView[]
    status?: TurnStatus
    errorMessage?: string
    tokenUsage?: LanguageModelUsage
    contextPromptTokens?: number
    finalText?: string
    startedAt?: number
    durationMs?: number
    sequence?: number
}

export type SystemMessageTone = 'info' | 'warning' | 'error'

export type SystemMessage = {
    id: string
    title: string
    content: string
    sequence: number
    tone?: SystemMessageTone
}

export type AgentActivityView = {
    agentId: string
    agentPath: string
    taskName: string
    parentId?: string
    status: AgentStatus
    lastMessage?: string
    error?: string
    updatedAt: string
}

export type TimelineItem =
    | { type: 'system'; sequence: number; message: SystemMessage }
    | { type: 'turn'; sequence: number; turn: TurnView }

export type FileSuggestion = {
    id: string
    path: string
    name: string
    parent?: string
    isDir: boolean
}

export type FileSuggestionRequest = {
    cwd: string
    query: string
    limit?: number
    maxDepth?: number
    maxEntries?: number
    respectGitIgnore?: boolean
    ignoreGlobs?: string[]
}
