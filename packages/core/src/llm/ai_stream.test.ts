import { beforeEach, describe, expect, test, vi } from 'vitest'
import { streamCallLLM } from '@memo/core/llm/ai_stream'
import type { AIProviderFactory } from '@memo/core/llm/ai_provider'
import type { ModelProfile } from '@memo/core/llm/model_profile'
import type { ChatMessage } from '@memo/core/types'

const state = vi.hoisted(() => ({
    streamTextParams: [] as unknown[],
    parts: [] as unknown[],
    final: {} as Record<string, unknown>,
}))

vi.mock('ai', () => ({
    streamText: vi.fn((params: unknown) => {
        state.streamTextParams.push(params)
        return makeStreamResult()
    }),
    jsonSchema: (schema: unknown) => schema,
}))

function makeStreamResult() {
    async function* gen() {
        yield* state.parts
    }
    return {
        fullStream: gen(),
        // AI SDK v6 awaitable properties (Promise.resolve values are awaitable).
        text: Promise.resolve(state.final.text ?? ''),
        reasoningText: Promise.resolve(state.final.reasoning),
        toolCalls: Promise.resolve(state.final.toolCalls ?? []),
        toolResults: Promise.resolve(state.final.toolResults ?? []),
        usage: Promise.resolve(state.final.usage),
        finishReason: Promise.resolve(state.final.finishReason ?? 'stop'),
    }
}

const PROFILE: ModelProfile = {
    wireApi: 'chat_completions',
    supportsParallelToolCalls: false,
    supportsReasoningContent: false,
    isFallback: false,
}

const FACTORY: AIProviderFactory = {
    kind: 'openai-compatible',
    build: () => ((model: string) => model) as never,
    buildProviderOptions: () => undefined,
}

function baseParams(overrides: Record<string, unknown> = {}) {
    return {
        provider: { name: 'mock', env_api_key: 'MOCK_API_KEY', model: 'mock-model', base_url: 'https://mock.local/v1' },
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'hi' }] as ChatMessage[],
        toolDefinitions: [],
        profile: PROFILE,
        factory: FACTORY,
        ...overrides,
    }
}

function textDelta(text: string) {
    return { type: 'text-delta', id: 't', text }
}

describe('streamCallLLM', () => {
    beforeEach(() => {
        state.streamTextParams = []
        state.parts = []
        state.final = {
            text: '',
            toolCalls: [],
            toolResults: [],
            usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
            finishReason: 'stop',
        }
    })

    test('streams text deltas through onChunk and returns assembled result', async () => {
        state.parts = [textDelta('Hel'), textDelta('lo'), textDelta(' world')]
        state.final = {
            text: 'Hello world',
            toolCalls: [],
            toolResults: [],
            usage: state.final.usage,
            finishReason: 'stop',
        }
        const chunks: string[] = []
        const result = await streamCallLLM(baseParams({ onChunk: (chunk: string) => chunks.push(chunk) }))

        expect(chunks).toEqual(['Hel', 'lo', ' world'])
        expect(result.text).toBe('Hello world')
        expect(result.toolCalls).toEqual([])
    })

    test('returns reasoningText as reasoning', async () => {
        state.parts = []
        state.final = {
            text: 'answer',
            reasoning: 'thinking',
            toolCalls: [],
            toolResults: [],
            usage: state.final.usage,
            finishReason: 'stop',
        }
        const result = await streamCallLLM(baseParams())

        expect(result.reasoning).toBe('thinking')
    })

    test('returns toolCalls, toolResults and usage from the final result', async () => {
        state.parts = []
        state.final = {
            text: 'using tools',
            toolCalls: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'echo', input: { value: 1 } }],
            toolResults: [
                {
                    type: 'tool-result',
                    toolCallId: 'call-1',
                    toolName: 'echo',
                    output: { type: 'text', value: 'ok' },
                },
            ],
            usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
            finishReason: 'tool-calls',
        }
        const result = await streamCallLLM(baseParams())

        expect(result.toolCalls).toHaveLength(1)
        expect(result.toolResults).toHaveLength(1)
        expect(result.toolResults[0]).toMatchObject({ toolCallId: 'call-1', toolName: 'echo' })
        expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 })
        expect(result.finishReason).toBe('tool-calls')
    })

    test('throws error part payloads', async () => {
        state.parts = [{ type: 'error', error: new Error('provider exploded') }]
        await expect(streamCallLLM(baseParams())).rejects.toThrow('provider exploded')
    })

    test('normalizes aborted streams to AbortError', async () => {
        state.parts = [{ type: 'error', error: new Error('fetch failed') }]
        const controller = new AbortController()
        controller.abort()
        await expect(streamCallLLM(baseParams({ signal: controller.signal }))).rejects.toMatchObject({
            name: 'AbortError',
        })
    })

    test('omits tools and toolChoice when no tool registry', async () => {
        state.parts = []
        await streamCallLLM(baseParams({ tools: undefined, toolContext: undefined }))

        const params = state.streamTextParams[0] as { tools?: unknown; toolChoice?: unknown }
        expect(params.tools).toBeUndefined()
        expect(params.toolChoice).toBeUndefined()
    })

    test('passes tools with execute wrappers and toolChoice auto when registry provided', async () => {
        const signal = new AbortController().signal
        const factory: AIProviderFactory = {
            kind: 'openai-compatible',
            build: () => ((model: string) => model) as never,
            buildProviderOptions: () => ({ parallel_tool_calls: true }),
        }
        state.parts = []
        const registry = {
            echo: {
                name: 'echo',
                description: 'echo',
                source: 'native' as const,
                inputSchema: { type: 'object' },
                execute: async () => ({ type: 'text' as const, value: 'ok' }),
            },
        }
        const toolContext = {
            approvalManager: { check: () => ({ needApproval: false as const, decision: 'auto-execute' as const }) },
            approvalHooks: {},
            toolsDisabled: false,
            onRepeatedAction: () => {},
            gate: { acquire: async () => ({ skipped: false as const, release: () => {} }), markDenied: () => {} },
        }
        await streamCallLLM(
            baseParams({
                factory,
                signal,
                tools: registry,
                toolContext,
            }),
        )

        const params = state.streamTextParams[0] as {
            tools?: Record<string, unknown>
            toolChoice?: unknown
            abortSignal?: AbortSignal
            providerOptions?: unknown
        }
        expect(params.tools).toBeDefined()
        expect(typeof params.tools?.echo).toBe('object')
        expect(params.toolChoice).toBe('auto')
        expect(params.abortSignal).toBe(signal)
        expect(params.providerOptions).toEqual({ mock: { parallel_tool_calls: true } })
    })
})
