/** @file Message construction and LLM result normalization for the agent loop. */
import type { LanguageModelUsage, ToolCallPart } from 'ai'
import type { ChatMessage, LLMResult, ToolRegistry } from '@memo/core/types'
import type { ToolActionResult } from '@memo/tools/orchestrator'

const TOOL_SKIPPED_AFTER_REJECTION_MESSAGE = 'Skipped tool execution after previous rejection.'

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

/** Tool action result → tool history message (CoreMessage shape). */
export function toToolHistoryMessage(result: ToolActionResult): ChatMessage {
    return {
        role: 'tool',
        content: [
            {
                type: 'tool-result',
                toolCallId: result.actionId,
                toolName: result.tool,
                output: { type: 'text', value: result.observation },
            },
        ],
    }
}

/** Fill missing tool results (rejection/abort) so every requested call has a protocol-complete result. */
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
