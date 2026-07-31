import { describe, expect, test } from 'vitest'
import { buildChatCompletionRequest, resolveModelProfile, type ModelProfile } from '@memo/core/runtime/model_profile'
import type { ToolDefinition } from '@memo/core/types'

function sampleProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
    return {
        wireApi: 'chat_completions',
        supportsParallelToolCalls: false,
        supportsReasoningContent: false,
        isFallback: false,
        ...overrides,
    }
}

const SAMPLE_TOOLS: ToolDefinition[] = [
    {
        name: 'read_file',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
    },
]

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

describe('buildChatCompletionRequest', () => {
    test('enables parallel tool calls only when profile supports it', () => {
        const request = buildChatCompletionRequest({
            model: 'gpt-5',
            messages: [{ role: 'user', content: 'hi' }],
            toolDefinitions: SAMPLE_TOOLS,
            profile: sampleProfile({ supportsParallelToolCalls: true }),
        })

        expect(request.tool_choice).toBe('auto')
        expect(Array.isArray(request.tools)).toBe(true)
        expect((request as Record<string, unknown>).parallel_tool_calls).toBe(true)
    })

    test('omits tool config and parallel flag when no tools are present', () => {
        const request = buildChatCompletionRequest({
            model: 'gpt-5',
            messages: [{ role: 'user', content: 'hi' }],
            toolDefinitions: [],
            profile: sampleProfile({ supportsParallelToolCalls: true }),
        })

        expect(request.tools).toBeUndefined()
        expect(request.tool_choice).toBeUndefined()
        expect((request as Record<string, unknown>).parallel_tool_calls).toBeUndefined()
    })
})
