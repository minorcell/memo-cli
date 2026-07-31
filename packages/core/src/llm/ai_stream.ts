/** @file Default streaming LLM call backed by AI SDK streamText. */
import { jsonSchema, streamText, type ModelMessage } from 'ai'
import type { LLMResult, ToolDefinition } from '@memo/core/types'
import type { ProviderConfig } from '@memo/core/config/config'
import type { ModelProfile } from '@memo/core/llm/model_profile'
import type { AIProviderFactory } from '@memo/core/llm/ai_provider'

export type StreamCallLLMParams = {
    provider: ProviderConfig
    apiKey: string
    /** CoreMessage[] (ChatMessage alias) — passed to streamText as-is. */
    messages: ModelMessage[]
    toolDefinitions: ToolDefinition[]
    profile: ModelProfile
    factory: AIProviderFactory
    onChunk?: (chunk: string) => void
    signal?: AbortSignal
}

/** ToolDefinition[] → AI SDK tools map; forces a top-level type: 'object' (vercel/ai#7924). */
export function buildStreamTools(toolDefinitions: ToolDefinition[]) {
    if (toolDefinitions.length === 0) return undefined
    return Object.fromEntries(
        toolDefinitions.map((tool) => [
            tool.name,
            {
                description: tool.description,
                inputSchema: jsonSchema(
                    tool.input_schema?.type === 'object' ? tool.input_schema : { ...tool.input_schema, type: 'object' },
                ),
            },
        ]),
    )
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

/** Default callLLM implementation: stream via AI SDK, return the final GenerateTextResult. */
export async function streamCallLLM(params: StreamCallLLMParams): Promise<LLMResult> {
    const { provider, apiKey, messages, toolDefinitions, profile, factory, onChunk, signal } = params
    const tools = buildStreamTools(toolDefinitions)
    const model = factory.build(provider, apiKey)(provider.model)
    const requestProviderOptions = factory.buildProviderOptions(profile)

    const result = streamText({
        model,
        messages,
        tools,
        toolChoice: tools ? 'auto' : undefined,
        abortSignal: signal,
        // Non-standard wire fields (e.g. parallel_tool_calls) pass through under the provider instance name.
        providerOptions: requestProviderOptions ? { [provider.name]: requestProviderOptions } : undefined,
    })

    try {
        for await (const part of result.fullStream) {
            if (part.type === 'text-delta') onChunk?.(part.text)
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
        usage: await result.usage,
        finishReason: await result.finishReason,
    }
}
