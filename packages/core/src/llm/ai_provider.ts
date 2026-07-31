/** @file AI SDK provider factory registry: dispatch by provider name to AI SDK providers. */
import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import type { JSONValue } from 'ai'
import type { ProviderConfig } from '@memo/core/config/config'
import type { ModelProfile } from '@memo/core/llm/model_profile'

/** Wire API kinds supported by the registry (future: responses / messages). */
export type ProviderKind = 'openai-compatible' | 'openai' | 'anthropic'

export type AIProviderFactory = {
    kind: ProviderKind
    /** Build an AI SDK provider instance (callable: factory(config, apiKey)('model-id')). */
    build: (config: ProviderConfig, apiKey: string) => OpenAICompatibleProvider
    /**
     * Request-level providerOptions for non-standard wire fields.
     * Keyed by the provider instance name (config.name) inside streamCallLLM.
     */
    buildProviderOptions: (profile: ModelProfile) => Record<string, JSONValue> | undefined
}

function openAICompatibleFactory(defaultBaseURL?: string): AIProviderFactory {
    return {
        kind: 'openai-compatible',
        build: (config, apiKey) =>
            createOpenAICompatible({
                name: config.name,
                apiKey,
                // Same default as the OpenAI SDK when base_url is unset.
                baseURL: config.base_url ?? defaultBaseURL ?? 'https://api.openai.com/v1',
                // Stream usage back through stream_options.include_usage.
                includeUsage: true,
            }),
        buildProviderOptions: (profile) =>
            profile.supportsParallelToolCalls ? { parallel_tool_calls: true } : undefined,
    }
}

const REGISTRY: Readonly<Record<string, AIProviderFactory>> = {
    deepseek: openAICompatibleFactory('https://api.deepseek.com'),
    // Extend here when wiring new providers:
    // - 'openai': switch to @ai-sdk/openai (chat completions or Responses API); buildProviderOptions uses camelCase parallelToolCalls.
    // - 'anthropic': switch to @ai-sdk/anthropic (Messages API); wire format no longer OpenAI-compatible.
    anthropic: {
        kind: 'anthropic',
        build: () => {
            throw new Error("Provider 'anthropic' requires the Anthropic Messages API; not yet wired to AI SDK")
        },
        buildProviderOptions: () => undefined,
    },
}

/** Dispatch by provider name; unknown names fall back to OpenAI-compatible (config.base_url decides the endpoint). */
export function getProviderFactory(config: Pick<ProviderConfig, 'name'>): AIProviderFactory {
    const name = config.name.trim().toLowerCase()
    return REGISTRY[name] ?? openAICompatibleFactory()
}
