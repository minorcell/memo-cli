import { describe, expect, test } from 'vitest'
import { resolveModelProfile } from '@memo/core/llm/model_profile'

describe('resolveModelProfile', () => {
    test('uses conservative fallback when no local override exists', () => {
        const resolved = resolveModelProfile({
            name: 'openai',
            model: 'gpt-5',
        })

        expect(resolved.profile.isFallback).toBe(true)
        expect(resolved.profile.supportsParallelToolCalls).toBe(false)
        expect(resolved.profile.supportsReasoningContent).toBe(false)
        expect(resolved.warning).toBeUndefined()
    })

    test('returns conservative fallback for unknown models', () => {
        const resolved = resolveModelProfile({
            name: 'custom',
            model: 'my-local-model',
        })

        expect(resolved.profile.isFallback).toBe(true)
        expect(resolved.profile.supportsParallelToolCalls).toBe(false)
        expect(resolved.profile.supportsReasoningContent).toBe(false)
        expect(resolved.warning).toBeUndefined()
    })

    test('applies model override for unknown model and suppresses fallback warning', () => {
        const resolved = resolveModelProfile(
            { name: 'custom', model: 'my-local-model' },
            {
                'my-local-model': {
                    supports_parallel_tool_calls: true,
                    supports_reasoning_content: true,
                },
            },
        )

        expect(resolved.profile.isFallback).toBe(false)
        expect(resolved.profile.supportsParallelToolCalls).toBe(true)
        expect(resolved.profile.supportsReasoningContent).toBe(true)
        expect(resolved.warning).toBeUndefined()
    })

    test('provider-specific override has higher priority than model-only override', () => {
        const resolved = resolveModelProfile(
            { name: 'openai', model: 'gpt-5' },
            {
                'gpt-5': {
                    supports_parallel_tool_calls: true,
                },
                'openai:gpt-5': {
                    supports_parallel_tool_calls: false,
                },
            },
        )

        expect(resolved.profile.supportsParallelToolCalls).toBe(false)
    })
})
