import type {
    AgentSessionOptions,
    AssistantToolCall,
    ChatMessage,
    HistoryEvent,
    HistorySink,
    LLMResponse,
    SessionMode,
    TextBlock,
    TokenUsage,
    ToolPermissionMode,
    ToolRegistry,
    ToolUseBlock,
} from '@memo/core/types'
import type { ToolActionResult, ToolActionStatus } from '@memo/tools/orchestrator'

export const DEFAULT_SESSION_MODE: SessionMode = 'interactive'
export const DEFAULT_CONTEXT_WINDOW = 120_000
export const TOOL_ACTION_SUCCESS_STATUS: ToolActionStatus = 'success'
export const TOOL_DISABLED_ERROR_MESSAGE =
    'Tool usage is disabled in the current permission mode. Switch to /tools once or /tools full to enable tools.'
export const SESSION_TITLE_MAX_CHARS = 60
export const TOOL_SKIPPED_AFTER_REJECTION_MESSAGE = 'Skipped tool execution after previous rejection.'
export const TOOL_SKIPPED_DISABLED_MESSAGE = 'Tool execution skipped: tools are disabled in current permission mode.'

export type ResolvedToolPermission = {
    mode: ToolPermissionMode | 'auto'
    toolsDisabled: boolean
    dangerous: boolean
    approvalMode: 'auto' | 'strict'
}

function writeStructuredError(payload: Record<string, unknown>) {
    process.stderr.write(`${JSON.stringify(payload)}\n`)
}

export function resolveToolPermission(options: AgentSessionOptions): ResolvedToolPermission {
    if (options.toolPermissionMode === 'none') {
        return {
            mode: 'none',
            toolsDisabled: true,
            dangerous: false,
            approvalMode: 'auto',
        }
    }

    if (options.toolPermissionMode === 'once') {
        return {
            mode: 'once',
            toolsDisabled: false,
            dangerous: false,
            approvalMode: 'auto',
        }
    }

    if (options.toolPermissionMode === 'full') {
        return {
            mode: 'full',
            toolsDisabled: false,
            dangerous: true,
            approvalMode: 'auto',
        }
    }

    const dangerous = options.dangerous ?? false
    return {
        mode: dangerous ? 'full' : 'auto',
        toolsDisabled: false,
        dangerous,
        approvalMode: 'auto',
    }
}

export function emptyUsage(): TokenUsage {
    return { prompt: 0, completion: 0, total: 0 }
}

export function accumulateUsage(target: TokenUsage, delta?: Partial<TokenUsage>) {
    if (!delta) return
    const promptDelta = delta.prompt ?? 0
    const completionDelta = delta.completion ?? 0
    const totalDelta = delta.total ?? promptDelta + completionDelta
    target.prompt += promptDelta
    target.completion += completionDelta
    target.total += totalDelta
}

export function normalizeLLMResponse(raw: LLMResponse): {
    textContent: string
    toolUseBlocks: Array<{ id: string; name: string; input: unknown }>
    reasoningContent?: string
    stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
    usage?: Partial<TokenUsage>
} {
    const textBlocks = raw.content.filter((block): block is TextBlock => block.type === 'text')
    const toolBlocks = raw.content.filter((block): block is ToolUseBlock => block.type === 'tool_use')

    return {
        textContent: textBlocks.map((b) => b.text).join('\n'),
        toolUseBlocks: toolBlocks.map((b) => ({
            id: b.id,
            name: b.name,
            input: b.input,
        })),
        reasoningContent:
            typeof raw.reasoning_content === 'string' && raw.reasoning_content.trim().length > 0
                ? raw.reasoning_content
                : undefined,
        stopReason: raw.stop_reason,
        usage: raw.usage,
    }
}

export async function emitEventToSinks(event: HistoryEvent, sinks: HistorySink[]) {
    for (const sink of sinks) {
        try {
            await sink.append(event)
        } catch (err) {
            writeStructuredError({
                level: 'error',
                event: 'history_sink_append_failed',
                sink: sink.constructor?.name || 'anonymous_sink',
                message: (err as Error).message,
            })
        }
    }
}

export function isAbortError(err: unknown): err is Error {
    if (!(err instanceof Error)) return false
    if (err.name === 'AbortError') return true

    const message = err.message?.toLowerCase?.() ?? ''
    return (
        message.includes('request was aborted') ||
        message.includes('operation was aborted') ||
        message.includes('aborted')
    )
}

// Stable serialization for duplicate action detection (ensures consistent key ordering)
export function stableStringify(value: unknown): string {
    return stableStringifyWithSeen(value, new WeakSet<object>(), 0)
}

const MAX_STABLE_STRINGIFY_DEPTH = 100

function stableStringifyWithSeen(value: unknown, seen: WeakSet<object>, depth: number): string {
    if (depth > MAX_STABLE_STRINGIFY_DEPTH) {
        return JSON.stringify('[MaxDepthExceeded]')
    }
    if (typeof value === 'bigint') {
        return JSON.stringify(value.toString())
    }
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
    if (seen.has(value)) {
        return JSON.stringify('[Circular]')
    }

    seen.add(value)
    if (Array.isArray(value)) {
        const result = `[${value.map((v) => stableStringifyWithSeen(v, seen, depth + 1)).join(',')}]`
        seen.delete(value)
        return result
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    const result = `{${entries
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringifyWithSeen(v, seen, depth + 1)}`)
        .join(',')}}`
    seen.delete(value)
    return result
}

export function buildAssistantToolCalls(
    toolUseBlocks: Array<{ id: string; name: string; input: unknown }>,
): AssistantToolCall[] {
    return toolUseBlocks.map((block) => ({
        id: block.id,
        type: 'function',
        function: {
            name: block.name,
            arguments: stableStringify(block.input),
        },
    }))
}

export function parseTextToolCall(text: string, tools: ToolRegistry): { tool: string; input: unknown } | null {
    const trimmed = text.trim()
    if (!trimmed) return null

    const candidates = [trimmed]
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (fenced?.[1]) {
        candidates.push(fenced[1].trim())
    }

    for (const candidate of candidates) {
        if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue
        try {
            const parsed = JSON.parse(candidate)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
            const obj = parsed as Record<string, unknown>
            const tool = typeof obj.tool === 'string' ? obj.tool.trim() : ''
            if (!tool || !Object.prototype.hasOwnProperty.call(tools, tool)) continue
            return { tool, input: obj.input ?? {} }
        } catch {
            // Ignore invalid json
        }
    }

    return null
}

export function truncateSessionTitle(input: string): string {
    if (input.length <= SESSION_TITLE_MAX_CHARS) return input
    return `${input.slice(0, SESSION_TITLE_MAX_CHARS - 3).trimEnd()}...`
}

export function normalizeSessionTitle(raw: string): string {
    const compact = raw
        .replace(/<\s*(think|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
        .replace(/<\s*\/?\s*(think|thinking)\b[^>]*>/gi, ' ')
        .replace(/\r?\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (!compact) return ''
    const unprefixed = compact.replace(/^(title|session title|标题)\s*[:：-]\s*/i, '').trim()
    if (!unprefixed) return ''
    const unquoted = unprefixed.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim()
    if (!unquoted) return ''
    return truncateSessionTitle(unquoted)
}

export function fallbackSessionTitleFromPrompt(input: string): string {
    const compact = input.replace(/\s+/g, ' ').trim()
    if (!compact) return 'New Session'

    // Keep short CJK/non-space prompts readable.
    if (!compact.includes(' ')) {
        return compact.length <= 20 ? compact : `${compact.slice(0, 20).trimEnd()}...`
    }

    const words = compact.split(' ').filter(Boolean)
    const short = words.slice(0, 8).join(' ')
    return truncateSessionTitle(short || compact)
}

export function toToolHistoryMessage(result: ToolActionResult): ChatMessage {
    return {
        role: 'tool',
        content: result.observation,
        tool_call_id: result.actionId,
        name: result.tool,
    }
}

export function completeToolResultsForProtocol(
    requested: Array<{ id: string; name: string }>,
    actual: ToolActionResult[],
    hasRejection: boolean,
): ToolActionResult[] {
    const byActionId = new Map(actual.map((result) => [result.actionId, result]))
    return requested.map((block) => {
        const found = byActionId.get(block.id)
        if (found) {
            return found
        }
        return {
            actionId: block.id,
            tool: block.name,
            status: hasRejection ? 'approval_denied' : 'execution_failed',
            errorType: hasRejection ? 'approval_denied' : 'execution_failed',
            success: false,
            observation: hasRejection
                ? `${TOOL_SKIPPED_AFTER_REJECTION_MESSAGE} ${block.name}`
                : `Tool result missing for ${block.name}; execution aborted before producing output.`,
            durationMs: 0,
            rejected: hasRejection ? true : undefined,
        }
    })
}
