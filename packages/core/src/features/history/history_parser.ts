import { basename } from 'node:path'
import type {
    SessionDetail,
    SessionEventItem,
    SessionListItem,
    SessionRuntimeStatus,
    SessionTurnDetail,
    SessionTurnStep,
    TokenUsageSummary,
    ToolUsageSummary,
} from '../../api_types.js'
import { workspaceIdFromCwd } from '../../utils/workspace.js'

type MutableTurnDetail = SessionTurnDetail & {
    byStep: Map<number, SessionTurnStep>
}

type ParseResultState = {
    sessionId: string
    title: string
    project: string
    cwd: string
    startedAt: string
    updatedAt: string
    status: SessionRuntimeStatus
    turnCount: number
    tokenUsage: TokenUsageSummary
    toolUsage: ToolUsageSummary
    turnsById: Map<number, MutableTurnDetail>
    summaryParts: string[]
    hasError: boolean
    hasCancelled: boolean
}

function defaultTokenUsage(): TokenUsageSummary {
    return {
        prompt: 0,
        completion: 0,
        total: 0,
    }
}

function defaultToolUsage(): ToolUsageSummary {
    return {
        total: 0,
        success: 0,
        failed: 0,
        denied: 0,
        cancelled: 0,
    }
}

function safeString(value: unknown): string {
    if (typeof value !== 'string') return ''
    return value.trim()
}

function sanitizeTitle(value: unknown): string {
    const raw = safeString(value)
    if (!raw) return ''

    const withoutBlocks = raw.replace(/<\s*(think|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    const withoutTags = withoutBlocks.replace(/<\s*\/?\s*(think|thinking)\b[^>]*>/gi, ' ')

    return withoutTags.replace(/\s+/g, ' ').trim()
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deriveSessionId(filePath: string, events: SessionEventItem[]): string {
    for (const event of events) {
        const metaSessionId = event.meta?.sessionId
        if (typeof metaSessionId === 'string' && metaSessionId.trim()) {
            return metaSessionId.trim()
        }
    }

    const fromEvent = events.find((event) => {
        if (!event.meta) return false
        const sessionId = (event.meta as { sessionId?: unknown }).sessionId
        return typeof sessionId === 'string' && sessionId.trim().length > 0
    })
    if (fromEvent?.meta && typeof fromEvent.meta.sessionId === 'string') {
        return fromEvent.meta.sessionId
    }

    const filename = basename(filePath, '.jsonl')
    const dash = filename.lastIndexOf('-')
    if (dash <= 0 || dash >= filename.length - 1) return filename
    return filename.slice(dash + 1)
}

function deriveProjectFromCwd(cwd: string, fallbackPath: string): string {
    if (cwd) {
        const normalized = cwd.replace(/\\/g, '/')
        const parts = normalized.split('/').filter(Boolean)
        const project = parts[parts.length - 1]
        if (project) return project
    }
    return basename(fallbackPath, '.jsonl')
}

function ensureTurn(state: ParseResultState, turnId: number): MutableTurnDetail {
    const existing = state.turnsById.get(turnId)
    if (existing) return existing
    const created: MutableTurnDetail = {
        turn: turnId,
        steps: [],
        byStep: new Map<number, SessionTurnStep>(),
    }
    state.turnsById.set(turnId, created)
    return created
}

function ensureStep(turn: MutableTurnDetail, stepId: number): SessionTurnStep {
    const existing = turn.byStep.get(stepId)
    if (existing) return existing
    const created: SessionTurnStep = {
        step: stepId,
    }
    turn.byStep.set(stepId, created)
    turn.steps = Array.from(turn.byStep.values()).sort((a, b) => a.step - b.step)
    return created
}

function parseEventLine(line: string, index: number): SessionEventItem | null {
    if (!line.trim()) return null

    let parsed: unknown
    try {
        parsed = JSON.parse(line)
    } catch {
        return null
    }

    if (!isRecord(parsed)) return null

    const ts = safeString(parsed.ts)
    const type = safeString(parsed.type)
    if (!ts || !type) return null

    const event: SessionEventItem = {
        index,
        ts,
        type,
    }

    const turn = asNumber(parsed.turn)
    const step = asNumber(parsed.step)
    if (turn !== null) event.turn = Math.floor(turn)
    if (step !== null) event.step = Math.floor(step)

    const role = safeString(parsed.role)
    if (role) event.role = role

    if (typeof parsed.content === 'string') {
        event.content = parsed.content
    }

    if (isRecord(parsed.meta)) {
        event.meta = parsed.meta
    }

    return event
}

function accumulateTokenUsage(target: TokenUsageSummary, source: Record<string, unknown> | undefined): void {
    if (!source) return
    // meta.tokens now uses AI SDK LanguageModelUsage shape; keep reading legacy prompt/completion fields too.
    const prompt = asNumber(source.inputTokens) ?? asNumber(source.prompt)
    const completion = asNumber(source.outputTokens) ?? asNumber(source.completion)
    const total = asNumber(source.totalTokens) ?? asNumber(source.total)

    if (prompt !== null) target.prompt += Math.floor(prompt)
    if (completion !== null) target.completion += Math.floor(completion)
    if (total !== null) target.total += Math.floor(total)
}

function normalizeFinalStatus(raw: string | undefined): SessionRuntimeStatus {
    if (!raw) return 'idle'
    const normalized = raw.trim().toLowerCase()
    if (!normalized) return 'idle'
    if (normalized === 'cancelled') return 'cancelled'
    if (normalized === 'error' || normalized === 'prompt_limit') return 'error'
    if (normalized === 'running') return 'running'
    return 'idle'
}

function collectActionToolNames(meta: Record<string, unknown> | undefined): string[] {
    if (!meta) return []

    const tools: string[] = []
    const tool = safeString(meta.tool)
    if (tool) tools.push(tool)

    const list = meta.tools
    if (Array.isArray(list)) {
        for (const item of list) {
            const value = safeString(item)
            if (value) tools.push(value)
        }
    }

    const toolBlocks = meta.toolBlocks
    if (Array.isArray(toolBlocks)) {
        for (const block of toolBlocks) {
            if (!isRecord(block)) continue
            const name = safeString(block.name)
            if (name) tools.push(name)
        }
    }

    return Array.from(new Set(tools))
}

function applyObservationStatus(state: ParseResultState, resultStatus: string | undefined): void {
    if (!resultStatus) return
    const normalized = resultStatus.trim().toLowerCase()
    if (!normalized) return

    if (normalized === 'success') {
        state.toolUsage.success += 1
        return
    }

    if (normalized === 'approval_denied') {
        state.toolUsage.denied += 1
        state.toolUsage.failed += 1
        state.hasCancelled = true
        return
    }

    if (normalized === 'cancelled') {
        state.toolUsage.cancelled += 1
        state.hasCancelled = true
        return
    }

    state.toolUsage.failed += 1
    state.hasError = true
}

export function parseHistoryEvents(raw: string): SessionEventItem[] {
    const lines = raw.split('\n')
    const events: SessionEventItem[] = []
    for (let i = 0; i < lines.length; i += 1) {
        const event = parseEventLine(lines[i] ?? '', i)
        if (event) events.push(event)
    }
    return events
}

export function parseHistoryLogToSessionDetail(raw: string, filePath: string): SessionDetail {
    const events = parseHistoryEvents(raw)
    const fallbackNow = new Date().toISOString()

    const state: ParseResultState = {
        sessionId: '',
        title: '',
        project: '',
        cwd: '',
        startedAt: events[0]?.ts ?? fallbackNow,
        updatedAt: events[events.length - 1]?.ts ?? events[0]?.ts ?? fallbackNow,
        status: 'idle',
        turnCount: 0,
        tokenUsage: defaultTokenUsage(),
        toolUsage: defaultToolUsage(),
        turnsById: new Map<number, MutableTurnDetail>(),
        summaryParts: [],
        hasError: false,
        hasCancelled: false,
    }

    for (const event of events) {
        if (event.ts > state.updatedAt) {
            state.updatedAt = event.ts
        }

        if (event.type === 'session_start' && event.meta) {
            const cwd = safeString(event.meta.cwd)
            if (cwd) state.cwd = cwd
        }

        if (event.type === 'session_title') {
            const title = sanitizeTitle(event.content)
            if (title) state.title = title
        }

        if (event.type === 'turn_start') {
            const turnId = event.turn ?? state.turnCount + 1
            const turn = ensureTurn(state, turnId)
            turn.input = event.content
            turn.startedAt = event.ts
            state.turnCount = Math.max(state.turnCount, turnId)
            if (event.content && event.content.trim()) {
                if (!state.title) state.title = sanitizeTitle(event.content)
                state.summaryParts.push(`User: ${event.content.trim()}`)
            }
        }

        if (event.type === 'assistant' && typeof event.turn === 'number') {
            const turn = ensureTurn(state, event.turn)
            const step = ensureStep(turn, event.step ?? turn.steps.length)
            const current = step.assistantText ?? ''
            step.assistantText = `${current}${event.content ?? ''}`
            if (event.content?.trim()) {
                state.summaryParts.push(`Assistant: ${event.content.trim()}`)
            }
        }

        if (event.type === 'action' && typeof event.turn === 'number') {
            const turn = ensureTurn(state, event.turn)
            const step = ensureStep(turn, event.step ?? turn.steps.length)
            const names = collectActionToolNames(event.meta)
            for (const _name of names) {
                state.toolUsage.total += 1
            }

            const tool = safeString(event.meta?.tool)
            if (tool) {
                step.action = {
                    tool,
                    input: event.meta?.input,
                }
            }
            const thinking = safeString(event.meta?.thinking)
            if (thinking) step.thinking = thinking

            if (Array.isArray(event.meta?.toolBlocks)) {
                const parallelActions = (event.meta.toolBlocks as unknown[])
                    .filter(isRecord)
                    .map((block) => {
                        const name = safeString(block.name)
                        if (!name) return null
                        return {
                            tool: name,
                            input: block.input,
                        }
                    })
                    .filter((item): item is { tool: string; input: unknown } => Boolean(item))
                if (parallelActions.length > 1) step.parallelActions = parallelActions
            }
        }

        if (event.type === 'observation' && typeof event.turn === 'number') {
            const turn = ensureTurn(state, event.turn)
            const step = ensureStep(turn, event.step ?? turn.steps.length)
            step.observation = event.content
            const status = safeString(event.meta?.status)
            if (status) step.resultStatus = status
            applyObservationStatus(state, status)
        }

        if (event.type === 'final' && typeof event.turn === 'number') {
            const turn = ensureTurn(state, event.turn)
            turn.finalText = event.content

            const statusRaw = safeString(event.meta?.status)
            if (statusRaw) {
                turn.status = statusRaw
                const normalized = normalizeFinalStatus(statusRaw)
                if (normalized === 'error') state.hasError = true
                if (normalized === 'cancelled') state.hasCancelled = true
            }
            const errorMessage = safeString(event.meta?.errorMessage)
            if (errorMessage) turn.errorMessage = errorMessage

            if (isRecord(event.meta?.tokens)) {
                const turnUsage = defaultTokenUsage()
                accumulateTokenUsage(turnUsage, event.meta.tokens)
                turn.tokenUsage = turnUsage
                accumulateTokenUsage(state.tokenUsage, event.meta.tokens)
            }
        }

        if (event.type === 'turn_end') {
            const statusRaw = safeString(event.meta?.status)
            if (statusRaw) {
                const normalized = normalizeFinalStatus(statusRaw)
                if (normalized === 'error') state.hasError = true
                if (normalized === 'cancelled') state.hasCancelled = true
            }
            if (isRecord(event.meta?.tokens)) {
                accumulateTokenUsage(state.tokenUsage, event.meta.tokens)
            }
        }

        if (event.type === 'session_end' && isRecord(event.meta?.tokens)) {
            state.tokenUsage = defaultTokenUsage()
            accumulateTokenUsage(state.tokenUsage, event.meta.tokens)
        }
    }

    state.sessionId = deriveSessionId(filePath, events)
    state.project = deriveProjectFromCwd(state.cwd, filePath)
    state.title = sanitizeTitle(state.title)
    if (!state.title) state.title = state.project || state.sessionId

    if (state.hasError) {
        state.status = 'error'
    } else if (state.hasCancelled) {
        state.status = 'cancelled'
    } else {
        state.status = 'idle'
    }

    const day = state.startedAt.slice(0, 10)
    const turns = Array.from(state.turnsById.values())
        .sort((a, b) => a.turn - b.turn)
        .map((turn) => ({
            turn: turn.turn,
            input: turn.input,
            startedAt: turn.startedAt,
            finalText: turn.finalText,
            status: turn.status,
            errorMessage: turn.errorMessage,
            tokenUsage: turn.tokenUsage,
            steps: turn.steps,
        }))

    const summary: SessionListItem = {
        id: state.sessionId,
        sessionId: state.sessionId,
        filePath,
        title: state.title,
        project: state.project,
        workspaceId: state.cwd ? workspaceIdFromCwd(state.cwd) : '',
        cwd: state.cwd,
        date: {
            day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : fallbackNow.slice(0, 10),
            startedAt: state.startedAt,
            updatedAt: state.updatedAt,
        },
        status: state.status,
        turnCount: state.turnCount,
        tokenUsage: state.tokenUsage,
        toolUsage: state.toolUsage,
    }

    return {
        ...summary,
        summary: state.summaryParts.join('\n'),
        turns,
        events,
    }
}
