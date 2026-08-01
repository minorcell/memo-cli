/** @file Message construction and LLM result normalization for the agent loop. */
import type { LanguageModelUsage, ToolCallPart, ToolResultPart } from 'ai'
import type { ChatMessage, LLMResult, ToolRegistry } from '@memo/core/types'
import type { ToolActionStatus } from '@memo/core/tools/orchestrator'

export function parseToolArguments(
    raw: string,
): { ok: true; data: unknown } | { ok: false; raw: string; error: string } {
    try {
        return { ok: true, data: JSON.parse(raw) }
    } catch (err) {
        return { ok: false, raw, error: (err as Error).message }
    }
}

/** Extract session-level fields from an AI SDK GenerateTextResult. */
export function normalizeLLMResponse(raw: LLMResult): {
    textContent: string
    toolUseBlocks: Array<{ id: string; name: string; input: unknown }>
    reasoningContent?: string
    usage?: Partial<LanguageModelUsage>
    /** Executed tool results (AI SDK executed the tools inside streamText). */
    toolResults: ToolResultPart[]
} {
    let textContent = raw.text
    const toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = []
    for (const call of raw.toolCalls) {
        if (typeof call.input === 'string') {
            const parsed = parseToolArguments(call.input)
            if (parsed.ok) {
                toolUseBlocks.push({ id: call.toolCallId, name: call.toolName, input: parsed.data })
            } else {
                textContent = `${textContent}\n[tool_use parse error] ${parsed.error}; raw: ${parsed.raw}`.trim()
            }
        } else {
            toolUseBlocks.push({ id: call.toolCallId, name: call.toolName, input: call.input })
        }
    }
    return {
        textContent,
        toolUseBlocks,
        reasoningContent:
            typeof raw.reasoning === 'string' && raw.reasoning.trim().length > 0 ? raw.reasoning : undefined,
        usage: raw.usage,
        toolResults: raw.toolResults,
    }
}

/** ToolUseBlock[] → AI SDK tool-call parts (for assistant history messages). */
export function buildAssistantToolCalls(
    toolUseBlocks: Array<{ id: string; name: string; input: unknown }>,
): ToolCallPart[] {
    return toolUseBlocks.map((block) => ({
        type: 'tool-call',
        toolCallId: block.id,
        toolName: block.name,
        input: block.input,
    }))
}

/** Parse a plain-text tool call (legacy text protocol fallback). */
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

/** AI SDK ToolResultPart → tool history message (CoreMessage shape, passthrough). */
export function toToolHistoryMessage(result: ToolResultPart): ChatMessage {
    return {
        role: 'tool',
        content: [result],
    }
}

/** ToolResultPart → observation display text. */
export function outputToObservation(result: ToolResultPart): string {
    const output = result.output
    if (output.type === 'text' || output.type === 'error-text') return output.value
    if (output.type === 'json') return JSON.stringify(output.value)
    if (output.type === 'execution-denied') return output.reason ?? 'User denied tool execution'
    return '(no tool output)'
}

/** ToolResultPart → memo status ('success' | error type). */
export function mapOutputStatus(result: ToolResultPart): ToolActionStatus {
    if (result.output.type === 'execution-denied') return 'approval_denied'
    if (result.output.type === 'error-text') return 'execution_failed'
    return 'success'
}
