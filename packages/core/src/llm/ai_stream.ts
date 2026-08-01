/** @file Default streaming LLM call backed by AI SDK streamText. */
import { streamText, type ModelMessage, type ToolResultPart, type ToolSet } from 'ai'
import type { LLMResult } from '@memo/core/types'
import type { ToolExecutionContext } from '@memo/core/tools/sdk_tools'
import type { ProviderConfig } from '@memo/core/config/config'
import type { ModelProfile } from '@memo/core/llm/model_profile'
import type { AIProviderFactory } from '@memo/core/llm/ai_provider'

export type StreamCallLLMParams = {
    provider: ProviderConfig
    apiKey: string
    /** CoreMessage[] (ChatMessage alias) — passed to streamText as-is. */
    messages: ModelMessage[]
    /** Complete tool set (native + MCP + custom); undefined disables tools (compaction). */
    tools?: ToolSet
    profile: ModelProfile
    factory: AIProviderFactory
    toolContext?: ToolExecutionContext
    /** Thinking override; undefined follows profile.supportsReasoningContent. */
    thinking?: boolean
    onChunk?: (chunk: string) => void
    /** Streaming reasoning deltas (thinking trace); previously dropped silently. */
    onReasoningChunk?: (chunk: string) => void
    signal?: AbortSignal
}

/** Normalize stream errors so callers can detect aborts via name/message matching. */
export function normalizeStreamError(err: unknown, signal?: AbortSignal): Error {
    if (signal?.aborted) {
        const aborted = new Error('Request aborted')
        aborted.name = 'AbortError'
        return aborted
    }
    if (err instanceof Error && err.name === 'AbortError') return err
    if (err instanceof Error && /aborted/i.test(err.message)) {
        const aborted = new Error(err.message)
        aborted.name = 'AbortError'
        return aborted
    }
    return err instanceof Error ? err : new Error(String(err))
}

/** Default callLLM implementation: stream via AI SDK, tools execute inside streamText. */
export async function streamCallLLM(params: StreamCallLLMParams): Promise<LLMResult> {
    const {
        provider,
        apiKey,
        messages,
        tools,
        profile,
        factory,
        toolContext,
        thinking,
        onChunk,
        onReasoningChunk,
        signal,
    } = params
    const activeTools = tools && toolContext ? tools : undefined
    const model = factory.build(provider, apiKey)(provider.model)
    const requestProviderOptions = factory.buildProviderOptions(profile, thinking)

    const result = streamText({
        model,
        messages,
        tools: activeTools,
        toolChoice: activeTools ? 'auto' : undefined,
        // System messages are part of the memo history (initial prompt + mid-loop warnings);
        // they cannot move to the system option without restructuring the history model.
        allowSystemInMessages: true,
        abortSignal: signal,
        // Per-call context (approval manager / gate / hooks) read by the execute wrappers.
        experimental_context: toolContext,
        // Non-standard wire fields (e.g. parallel_tool_calls) pass through under the provider instance name.
        providerOptions: requestProviderOptions ? { [provider.name]: requestProviderOptions } : undefined,
    })

    try {
        for await (const part of result.fullStream) {
            if (part.type === 'text-delta') onChunk?.(part.text)
            else if (part.type === 'reasoning-delta') onReasoningChunk?.(part.text)
            else if (part.type === 'error') throw part.error
        }
    } catch (err) {
        throw normalizeStreamError(err, signal)
    }
    // StreamTextResult exposes awaitable properties that resolve once the stream finishes.
    return {
        text: await result.text,
        reasoning: (await result.reasoningText) ?? undefined,
        toolCalls: await result.toolCalls,
        toolResults: (await result.toolResults) as unknown as ToolResultPart[],
        usage: await result.usage,
        finishReason: await result.finishReason,
    }
}
