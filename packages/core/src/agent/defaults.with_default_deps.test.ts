import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentSessionDeps, AgentSessionOptions, ChatMessage, LLMResult, ToolRegistry } from '@memo/core/types'
import type { MCPServerConfig } from '@memo/core/config/config'
import type { AIProviderFactory } from '@memo/core/llm/ai_provider'
import { emptyUsage } from '@memo/core/agent/loop'
import type { Tool } from '@memo/core/tools/router'

const state = vi.hoisted(() => ({
    loadedConfig: {
        home: '/tmp/memo-home',
        path: '/tmp/memo-home/config.toml',
        config: {
            current_provider: 'mock',
            providers: [
                {
                    name: 'mock',
                    env_api_key: 'MOCK_API_KEY',
                    model: 'mock-model',
                    base_url: 'https://mock.local/v1',
                },
            ],
            model_profiles: {},
            mcp_servers: {
                alpha: { command: 'node', args: ['alpha.js'] } as MCPServerConfig,
                beta: { command: 'node', args: ['beta.js'] } as MCPServerConfig,
            },
        },
    },
    selectedProvider: {
        name: 'mock',
        env_api_key: 'MOCK_API_KEY',
        model: 'mock-model',
        base_url: 'https://mock.local/v1',
    },
    sessionsDir: '/tmp/memo-sessions',
    sessionPath: '/tmp/memo-sessions/session-1.jsonl',
    toolDescriptions: '## Tools\n- mock_tool',
    toolDefinitions: [{ type: 'function', function: { name: 'mock_tool', parameters: {} } }],
    registry: {
        mock_tool: {
            name: 'mock_tool',
            description: 'mock tool',
            source: 'native',
            inputSchema: { type: 'object' },
            execute: async () => ({ type: 'text', value: 'ok' }),
        } as Tool,
    } as ToolRegistry,
    loadMcpServersCalls: [] as unknown[],
    registerNativeToolsCalls: [] as unknown[],
    registerNativeToolCalls: [] as unknown[],
    historySinkPaths: [] as string[],
    routerDisposed: 0,
    createTokenCounterCalls: [] as Array<string | undefined>,
    promptText: 'SYSTEM_PROMPT',
    streamCalls: [] as unknown[],
    factoryLookups: [] as unknown[],
    factory: {
        kind: 'openai-compatible',
        build: vi.fn(),
        buildProviderOptions: vi.fn(() => undefined),
    } as unknown as AIProviderFactory,
    llmResponse: {
        text: 'ok',
        toolCalls: [] as LLMResult['toolCalls'],
        toolResults: [] as LLMResult['toolResults'],
        usage: {
            inputTokens: 11,
            outputTokens: 7,
            totalTokens: 18,
            inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
            outputTokenDetails: { reasoningTokens: undefined },
        },
        finishReason: 'stop',
    } as LLMResult,
}))

vi.mock('@memo/core/tools', () => ({
    NATIVE_TOOLS: [],
}))

vi.mock('@memo/core/config/config', () => ({
    loadMemoConfig: vi.fn(async () => state.loadedConfig),
    selectProvider: vi.fn(() => state.selectedProvider),
    getSessionsDir: vi.fn(() => state.sessionsDir),
    buildSessionPath: vi.fn(() => state.sessionPath),
}))

vi.mock('@memo/core/features/history', () => ({
    JsonlHistorySink: class JsonlHistorySink {
        constructor(path: string) {
            state.historySinkPaths.push(path)
        }
    },
}))

vi.mock('@memo/core/llm/model_profile', () => ({
    resolveModelProfile: vi.fn(() => ({ profile: { supportsParallelToolCalls: true } })),
}))

vi.mock('@memo/core/llm/ai_stream', () => ({
    streamCallLLM: vi.fn(async (params: unknown) => {
        state.streamCalls.push(params)
        return state.llmResponse
    }),
}))

vi.mock('@memo/core/llm/ai_provider', () => ({
    getProviderFactory: vi.fn((provider: unknown) => {
        state.factoryLookups.push(provider)
        return state.factory
    }),
}))

vi.mock('@memo/core/prompt/prompt', () => ({
    loadSystemPrompt: vi.fn(async () => state.promptText),
}))

vi.mock('@memo/core/utils/tokenizer', () => ({
    createTokenCounter: vi.fn(() => {
        state.createTokenCounterCalls.push(undefined)
        return {
            countText: (text: string) => text.length,
            countMessages: (messages: Array<{ content: string }>) =>
                messages.reduce((sum, message) => sum + message.content.length, 0),
        }
    }),
}))

vi.mock('@memo/core/tools/router', () => ({
    ToolRouter: class ToolRouter {
        registerNativeTools(tools: unknown) {
            state.registerNativeToolsCalls.push(tools)
        }

        async loadMcpServers(servers: unknown, options: unknown) {
            state.loadMcpServersCalls.push([servers, options])
        }

        registerNativeTool(tool: unknown) {
            state.registerNativeToolCalls.push(tool)
        }

        toRegistry() {
            return state.registry
        }

        generateToolDescriptions() {
            return state.toolDescriptions
        }

        generateToolDefinitions() {
            return state.toolDefinitions
        }

        async dispose() {
            state.routerDisposed += 1
        }
    },
}))

describe('withDefaultDeps (default path)', () => {
    beforeEach(() => {
        state.loadMcpServersCalls = []
        state.registerNativeToolsCalls = []
        state.registerNativeToolCalls = []
        state.historySinkPaths = []
        state.routerDisposed = 0
        state.createTokenCounterCalls = []
        state.toolDescriptions = '## Tools\n- mock_tool'
        state.promptText = 'SYSTEM_PROMPT'
        state.streamCalls = []
        state.factoryLookups = []
        state.llmResponse = {
            text: 'ok',
            toolCalls: [] as LLMResult['toolCalls'],
            toolResults: [] as LLMResult['toolResults'],
            usage: { ...emptyUsage(), inputTokens: 11, outputTokens: 7, totalTokens: 18 },
            finishReason: 'stop',
        } as LLMResult
        delete process.env.MOCK_API_KEY
        delete process.env.OPENAI_API_KEY
        delete process.env.DEEPSEEK_API_KEY
    })

    afterEach(() => {
        delete process.env.MOCK_API_KEY
        delete process.env.OPENAI_API_KEY
        delete process.env.DEEPSEEK_API_KEY
    })

    test('builds default deps with injected tool descriptions and default sinks', async () => {
        const { withDefaultDeps } = await import('@memo/core/agent/defaults')

        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-1')

        expect(state.loadMcpServersCalls).toHaveLength(1)
        expect(state.historySinkPaths).toEqual([state.sessionPath])
        expect(state.createTokenCounterCalls).toEqual([undefined])
        expect(resolved.historyFilePath).toBe(state.sessionPath)

        const prompt = await resolved.loadPrompt()
        expect(prompt).toContain('SYSTEM_PROMPT')
        expect(prompt).toContain('## Tools\n- mock_tool')
    })

    test('respects provided deps overrides (callLLM/historySinks/tokenCounter/loadPrompt/dispose)', async () => {
        const { withDefaultDeps } = await import('@memo/core/agent/defaults')
        const callLLM = vi.fn(async () => ({
            text: 'override',
            toolCalls: [] as LLMResult['toolCalls'],
            toolResults: [] as LLMResult['toolResults'],
            usage: emptyUsage(),
            finishReason: 'stop' as const,
        }))
        const historySinks = [{ append: vi.fn() }]
        const tokenCounter = {
            countText: (text: string) => text.length,
            countMessages: (messages: Array<{ content: string }>) =>
                messages.reduce((sum, message) => sum + message.content.length, 0),
        }
        const dispose = vi.fn(async () => {})

        const resolved = await withDefaultDeps(
            {
                callLLM,
                historySinks,
                tokenCounter,
                loadPrompt: async () => 'CUSTOM_PROMPT',
                dispose,
            } as AgentSessionDeps,
            {} as AgentSessionOptions,
            'session-2',
        )

        expect(await resolved.loadPrompt()).toContain('CUSTOM_PROMPT')
        expect(resolved.callLLM).toBe(callLLM)
        expect(resolved.historySinks).toBe(historySinks)
        expect(resolved.tokenCounter).toBe(tokenCounter)

        await resolved.dispose()
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(state.routerDisposed).toBe(1)
    })

    test('throws when provider api key is missing', async () => {
        const { withDefaultDeps } = await import('@memo/core/agent/defaults')
        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-3')

        await expect(resolved.callLLM([{ role: 'user', content: 'hello' } as ChatMessage])).rejects.toThrow(
            'Missing env var MOCK_API_KEY',
        )
    })

    test('falls back to OPENAI_API_KEY and delegates to streamCallLLM', async () => {
        process.env.OPENAI_API_KEY = 'openai-fallback-key'
        const { withDefaultDeps } = await import('@memo/core/agent/defaults')
        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-3b')
        const messages = [{ role: 'user', content: 'hello' } as ChatMessage]

        const response = await resolved.callLLM(messages)

        expect(response).toEqual(state.llmResponse)
        expect(state.factoryLookups).toEqual([state.selectedProvider])
        const call = state.streamCalls[0] as {
            provider: typeof state.selectedProvider
            apiKey: string
            messages: unknown[]
            toolDefinitions: unknown[]
            factory: unknown
        }
        expect(call.apiKey).toBe('openai-fallback-key')
        expect(call.provider).toEqual({
            name: 'mock',
            env_api_key: 'MOCK_API_KEY',
            model: 'mock-model',
            base_url: 'https://mock.local/v1',
        })
        expect(call.messages).toEqual(messages)
        expect(call.factory).toBe(state.factory)
    })

    test('passes call options (tools/signal) and forwards structured LLM response', async () => {
        process.env.MOCK_API_KEY = 'test-key'
        const { withDefaultDeps } = await import('@memo/core/agent/defaults')
        const signal = new AbortController().signal

        state.llmResponse = {
            text: 'assistant text',
            reasoning: 'reasoned',
            toolCalls: [{ type: 'tool-call', toolCallId: 'call-ok', toolName: 'echo', input: { value: 1 } }],
            toolResults: [] as LLMResult['toolResults'],
            usage: { ...emptyUsage(), inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            finishReason: 'tool-calls',
        }

        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-4')
        const response = await resolved.callLLM(
            [
                {
                    role: 'assistant',
                    content: [
                        { type: 'reasoning' as const, text: 'reasoning content' },
                        {
                            type: 'tool-call',
                            toolCallId: 'prev-call',
                            toolName: 'read_file',
                            input: {},
                        },
                    ],
                },
                {
                    role: 'tool',
                    content: [
                        {
                            type: 'tool-result',
                            toolCallId: 'prev-call',
                            toolName: 'read_file',
                            output: { type: 'text', value: 'observation' },
                        },
                    ],
                },
                { role: 'user', content: 'continue' },
            ],
            undefined,
            { signal },
        )

        expect(response).toEqual(state.llmResponse)

        const call = state.streamCalls[0] as {
            provider: typeof state.selectedProvider
            apiKey: string
            messages: Array<Record<string, unknown>>
            profile: unknown
            factory: unknown
            signal: AbortSignal
        }
        expect(call.apiKey).toBe('test-key')
        expect(call.signal).toBe(signal)
        expect(call.profile).toEqual({ supportsParallelToolCalls: true })
        expect(call.factory).toBe(state.factory)
        expect(
            (call.messages[0] as { content: Array<{ type: string }> }).content.some(
                (part) => part.type === 'reasoning',
            ),
        ).toBe(true)
        expect(
            (call.messages[0] as { content: Array<{ type: string }> }).content.some(
                (part) => part.type === 'tool-call',
            ),
        ).toBe(true)
        expect(
            (call.messages[1] as { content: Array<{ type: string }> }).content.some(
                (part) => part.type === 'tool-result',
            ),
        ).toBe(true)
    })

    test('forwards plain text response with usage', async () => {
        process.env.MOCK_API_KEY = 'test-key'
        const { withDefaultDeps } = await import('@memo/core/agent/defaults')

        state.llmResponse = {
            text: 'plain assistant answer',
            reasoning: 'concise reason',
            toolCalls: [] as LLMResult['toolCalls'],
            toolResults: [] as LLMResult['toolResults'],
            usage: { ...emptyUsage(), inputTokens: 3, outputTokens: 4, totalTokens: 7 },
            finishReason: 'stop',
        }

        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-5b')
        const response = await resolved.callLLM([{ role: 'user', content: 'x' } as ChatMessage])
        expect(response.finishReason).toBe('stop')
        expect(response.reasoning).toBe('concise reason')
        expect(response.text).toBe('plain assistant answer')
        expect(response.usage.inputTokens).toBe(3)
        expect(response.usage.outputTokens).toBe(4)
        expect(response.usage.totalTokens).toBe(7)
    })

    test('propagates streamCallLLM errors (e.g. empty content)', async () => {
        process.env.MOCK_API_KEY = 'test-key'
        const { withDefaultDeps } = await import('@memo/core/agent/defaults')
        const { streamCallLLM } = await import('@memo/core/llm/ai_stream')
        vi.mocked(streamCallLLM).mockRejectedValueOnce(new Error('OpenAI-compatible API returned empty content'))

        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-6')
        await expect(resolved.callLLM([{ role: 'user', content: 'x' } as ChatMessage])).rejects.toThrow(
            'OpenAI-compatible API returned empty content',
        )
    })
})
