import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getProviderFactory } from '@memo/core/llm/ai_provider'
import type { ModelProfile } from '@memo/core/llm/model_profile'

const state = vi.hoisted(() => ({
    createCalls: [] as unknown[],
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
    createOpenAICompatible: vi.fn((options: unknown) => {
        state.createCalls.push(options)
        return (model: string) => ({ model })
    }),
}))

const PROFILE: ModelProfile = {
    wireApi: 'chat_completions',
    supportsParallelToolCalls: false,
    supportsReasoningContent: false,
    isFallback: false,
}

describe('getProviderFactory', () => {
    beforeEach(() => {
        state.createCalls = []
    })

    test('dispatches deepseek to openai-compatible with default base URL', () => {
        const factory = getProviderFactory({ name: 'deepseek' })
        expect(factory.kind).toBe('openai-compatible')
        factory.build({ name: 'deepseek', env_api_key: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' }, 'secret')
        expect(state.createCalls[0]).toEqual({
            name: 'deepseek',
            apiKey: 'secret',
            baseURL: 'https://api.deepseek.com',
            includeUsage: true,
        })
    })

    test('config base_url overrides the default', () => {
        const factory = getProviderFactory({ name: 'deepseek' })
        factory.build(
            {
                name: 'deepseek',
                env_api_key: 'DEEPSEEK_API_KEY',
                model: 'deepseek-chat',
                base_url: 'https://proxy.local/v1',
            },
            'secret',
        )
        expect((state.createCalls[0] as { baseURL: string }).baseURL).toBe('https://proxy.local/v1')
    })

    test('falls back to openai-compatible for unknown providers', () => {
        const factory = getProviderFactory({ name: 'my-custom-vendor' })
        expect(factory.kind).toBe('openai-compatible')
        factory.build({ name: 'my-custom-vendor', env_api_key: 'X_KEY', model: 'm' }, 'secret')
        expect((state.createCalls[0] as { baseURL: string }).baseURL).toBe('https://api.openai.com/v1')
        expect((state.createCalls[0] as { name: string }).name).toBe('my-custom-vendor')
    })

    test('anthropic is registered but throws on build until wired', () => {
        const factory = getProviderFactory({ name: 'anthropic' })
        expect(factory.kind).toBe('anthropic')
        expect(() =>
            factory.build({ name: 'anthropic', env_api_key: 'ANTHROPIC_API_KEY', model: 'claude' }, 'secret'),
        ).toThrow('not yet wired to AI SDK')
    })

    test('is case/whitespace insensitive on provider name', () => {
        expect(getProviderFactory({ name: ' DeepSeek ' }).kind).toBe('openai-compatible')
    })
})

describe('buildProviderOptions', () => {
    test('no options when parallel tool calls unsupported', () => {
        const factory = getProviderFactory({ name: 'deepseek' })
        expect(factory.buildProviderOptions(PROFILE)).toBeUndefined()
    })

    test('parallel_tool_calls passthrough when supported', () => {
        const factory = getProviderFactory({ name: 'deepseek' })
        expect(factory.buildProviderOptions({ ...PROFILE, supportsParallelToolCalls: true })).toEqual({
            parallel_tool_calls: true,
        })
    })
})
