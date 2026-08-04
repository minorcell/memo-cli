/** @file Message construction and LLM result normalization for the agent loop. */
import type { LanguageModelUsage, ToolCallPart, ToolResultPart } from 'ai'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import type { ChatMessage, LLMResult, ToolRegistry } from '@memo/core/types'
import type { ToolActionStatus } from '@memo/core/tools/approval'
import { TOOL_SKIPPED_DISABLED_MESSAGE } from '@memo/core/tools/sdk_tools'
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
    /** Tool calls (AI SDK ToolCallPart[]; inputs are already parsed objects). */
    toolUseBlocks: ToolCallPart[]
    reasoningContent?: string
    usage?: Partial<LanguageModelUsage>
    /** Executed tool results (AI SDK executed the tools inside streamText). */
    toolResults: ToolResultPart[]
} {
    return {
        textContent: raw.text,
        toolUseBlocks: raw.toolCalls,
        reasoningContent:
            typeof raw.reasoning === 'string' && raw.reasoning.trim().length > 0 ? raw.reasoning : undefined,
        usage: raw.usage,
        toolResults: raw.toolResults,
    }
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

/**
 * 为没有对应结果的 tool-call 生成合成 tool 消息。AI SDK 在工具不可用
 * （如 MCP 断开）或执行被中断时不会为该 tool-call 产生 result；未配对的
 * tool-call 会让下一轮 streamText 抛 MissingToolResultsError，导致会话无法继续。
 */
export function buildMissingToolResultMessages(toolCalls: ToolCallPart[], toolResults: ToolResultPart[]): ChatMessage[] {
    const resultIds = new Set(toolResults.map((tr) => tr.toolCallId))
    const messages: ChatMessage[] = []
    for (const block of toolCalls) {
        if (block.providerExecuted || resultIds.has(block.toolCallId)) continue
        messages.push({
            role: 'tool',
            content: [
                {
                    type: 'tool-result',
                    toolCallId: block.toolCallId,
                    toolName: block.toolName,
                    output: {
                        type: 'error-text',
                        value: `Tool result missing: "${block.toolName}" could not be executed (tool unavailable or execution interrupted).`,
                    },
                },
            ],
        })
    }
    return messages
}

/** Detect the tools-disabled skip output (non-standard 'skipped' replaced by an error-text sentinel). */
export function isToolSkippedOutput(output: ToolResultOutput): boolean {
    return output.type === 'error-text' && output.value === TOOL_SKIPPED_DISABLED_MESSAGE
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
