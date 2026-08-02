import type { LanguageModelUsage } from 'ai'

export type TokenUsageSummary = LanguageModelUsage

export type ToolUsageSummary = {
    total: number
    success: number
    failed: number
    denied: number
    cancelled: number
}

export type SessionRuntimeStatus = 'idle' | 'running' | 'error' | 'cancelled'

export type SessionDateInfo = {
    day: string
    startedAt: string
    updatedAt: string
}

export type SessionListItem = {
    id: string
    sessionId: string
    filePath: string
    title: string
    project: string
    workspaceId: string
    cwd: string
    date: SessionDateInfo
    status: SessionRuntimeStatus
    turnCount: number
    tokenUsage: TokenUsageSummary
    toolUsage: ToolUsageSummary
}

export type SessionEventItem = {
    index: number
    ts: string
    type: string
    turn?: number
    step?: number
    role?: string
    content?: string
    meta?: Record<string, unknown>
}

export type SessionTurnStep = {
    step: number
    assistantText?: string
    thinking?: string
    action?: {
        toolCallId?: string
        tool: string
        input: unknown
    }
    parallelActions?: Array<{
        toolCallId?: string
        tool: string
        input: unknown
    }>
    observation?: string
    resultStatus?: string
    toolResults?: Array<{
        toolCallId?: string
        tool: string
        observation: string
        resultStatus?: string
    }>
}

export type SessionTurnDetail = {
    turn: number
    input?: string
    startedAt?: string
    finalText?: string
    status?: string
    errorMessage?: string
    tokenUsage?: TokenUsageSummary
    steps: SessionTurnStep[]
}

export type SessionDetail = SessionListItem & {
    summary: string
    turns: SessionTurnDetail[]
    events: SessionEventItem[]
    /** Provider name recorded at session start, if any. */
    providerName?: string
    /** Model name recorded at session start, if any. */
    modelName?: string
    /** Tool permission mode recorded at session start. */
    toolPermissionMode?: string
    /** Most recently recorded thinking override (undefined follows the model profile). */
    thinking?: boolean
    /** Latest successful context_compact summary, for --prev restore injection. */
    compactionSummary?: string
}

export type SessionListResponse = {
    items: SessionListItem[]
    page: number
    pageSize: number
    total: number
    totalPages: number
}

export type SessionEventsResponse = {
    items: SessionEventItem[]
    nextCursor: string | null
}

export type SkillRecord = {
    id: string
    name: string
    description: string
    scope: 'project' | 'global'
    path: string
    active: boolean
}

export type McpServerRecord = {
    name: string
    config: Record<string, unknown>
    authStatus: 'unsupported' | 'not_logged_in' | 'bearer_token' | 'oauth'
    active: boolean
}
