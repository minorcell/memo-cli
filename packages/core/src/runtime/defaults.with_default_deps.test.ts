import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentSessionDeps, AgentSessionOptions, ChatMessage, ToolRegistry } from '@memo/core/types'
import type { MCPServerConfig } from '@memo/core/config/config'
import type { Tool } from '@memo/tools/router'

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
            execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        } as Tool,
    } as ToolRegistry,
    buildRequestCalls: [] as unknown[],
    loadMcpServersCalls: [] as unknown[],
    registerNativeToolsCalls: [] as unknown[],
    registerNativeToolCalls: [] as unknown[],
    openaiCtorCalls: [] as unknown[],
    openaiCreateCalls: [] as unknown[],
    historySinkPaths: [] as string[],
    routerDisposed: 0,
    createTokenCounterCalls: [] as Array<string | undefined>,
    promptText: 'SYSTEM_PROMPT',
    openaiResponse: {
        choices: [
            {
                message: {
                    content: 'ok',
                },
            },
        ],
        usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            total_tokens: 18,
        },
    } as Record<string, unknown>,
}))

vi.mock('@memo/tools', () => ({
    NATIVE_TOOLS: [],
}))

vi.mock('@memo/core/config/config', () => ({
    loadMemoConfig: vi.fn(async () => state.loadedConfig),
    selectProvider: vi.fn(() => state.selectedProvider),
    getSessionsDir: vi.fn(() => state.sessionsDir),
    buildSessionPath: vi.fn(() => state.sessionPath),
}))

vi.mock('@memo/core/runtime/history', () => ({
    JsonlHistorySink: class JsonlHistorySink {
        constructor(path: string) {
            state.historySinkPaths.push(path)
        }
    },
}))

vi.mock('@memo/core/runtime/model_profile', () => ({
    resolveModelProfile: vi.fn(() => ({ profile: { supportsParallelToolCalls: true } })),
    buildChatCompletionRequest: vi.fn((request: unknown) => {
        state.buildRequestCalls.push(request)
        return request
    }),
}))

vi.mock('@memo/core/runtime/prompt', () => ({
    loadSystemPrompt: vi.fn(async () => state.promptText),
}))

vi.mock('@memo/core/utils/tokenizer', () => ({
    createTokenCounter: vi.fn((model?: string) => {
        state.createTokenCounterCalls.push(model)
        return {
            model: model ?? 'mock-tokenizer',
            countText: (text: string) => text.length,
            countMessages: (messages: Array<{ content: string }>) =>
                messages.reduce((sum, message) => sum + message.content.length, 0),
            dispose: vi.fn(),
        }
    }),
}))

vi.mock('@memo/tools/router', () => ({
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

vi.mock('openai', () => ({
    default: class OpenAI {
        chat = {
            completions: {
                create: async (request: unknown, options: unknown) => {
                    state.openaiCreateCalls.push({ request, options })
                    return state.openaiResponse
                },
            },
        }

        constructor(config: unknown) {
            state.openaiCtorCalls.push(config)
        }
    },
}))

describe('withDefaultDeps (default path)', () => {
    beforeEach(() => {
        state.buildRequestCalls = []
        state.loadMcpServersCalls = []
        state.registerNativeToolsCalls = []
        state.registerNativeToolCalls = []
        state.openaiCtorCalls = []
        state.openaiCreateCalls = []
        state.historySinkPaths = []
        state.routerDisposed = 0
        state.createTokenCounterCalls = []
        state.toolDescriptions = '## Tools\n- mock_tool'
        state.promptText = 'SYSTEM_PROMPT'
        state.openaiResponse = {
            choices: [
                {
                    message: {
                        content: 'ok',
                    },
                },
            ],
            usage: {
                prompt_tokens: 11,
                completion_tokens: 7,
                total_tokens: 18,
            },
        }
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
        const { withDefaultDeps } = await import('@memo/core/runtime/defaults')

        const resolved = await withDefaultDeps(
            {},
            { tokenizerModel: 'counter-model' } as AgentSessionOptions,
            'session-1',
        )

        expect(state.loadMcpServersCalls).toHaveLength(1)
        expect(state.historySinkPaths).toEqual([state.sessionPath])
        expect(state.createTokenCounterCalls).toEqual(['counter-model'])
        expect(resolved.historyFilePath).toBe(state.sessionPath)

        const prompt = await resolved.loadPrompt()
        expect(prompt).toContain('SYSTEM_PROMPT')
        expect(prompt).toContain('## Tools\n- mock_tool')
    })

    test('respects provided deps overrides (callLLM/historySinks/tokenCounter/loadPrompt/dispose)', async () => {
        const { withDefaultDeps } = await import('@memo/core/runtime/defaults')
        const callLLM = vi.fn(async () => ({
            content: [{ type: 'text' as const, text: 'override' }],
            stop_reason: 'end_turn' as const,
        }))
        const historySinks = [{ append: vi.fn() }]
        const tokenCounter = {
            model: 'custom-counter',
            countText: (text: string) => text.length,
            countMessages: (messages: Array<{ content: string }>) =>
                messages.reduce((sum, message) => sum + message.content.length, 0),
            dispose: vi.fn(),
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
        const { withDefaultDeps } = await import('@memo/core/runtime/defaults')
        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-3')

        await expect(resolved.callLLM([{ role: 'user', content: 'hello' } as ChatMessage])).rejects.toThrow(
            'Missing env var MOCK_API_KEY',
        )
    })

    test('falls back to OPENAI_API_KEY when provider key is missing', async () => {
        process.env.OPENAI_API_KEY = 'openai-fallback-key'
        const { withDefaultDeps } = await import('@memo/core/runtime/defaults')
        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-3b')

        await resolved.callLLM([{ role: 'user', content: 'hello' } as ChatMessage])
        expect(state.openaiCtorCalls[0]).toEqual({
            apiKey: 'openai-fallback-key',
            baseURL: 'https://mock.local/v1',
        })
    })

    test('maps tool calls into tool_use blocks and keeps parse errors as text', async () => {
        process.env.MOCK_API_KEY = 'test-key'
        const { withDefaultDeps } = await import('@memo/core/runtime/defaults')
        const callOptionsTools = [{ type: 'function', function: { name: 'override', parameters: {} } }]
        const signal = new AbortController().signal

        state.openaiResponse = {
            choices: [
                {
                    message: {
                        content: 'assistant text',
                        reasoning_content: '  reasoned  ',
                        tool_calls: [
                            {
                                id: 'call-ok',
                                type: 'function',
                                function: { name: 'echo', arguments: '{"value":1}' },
                            },
                            {
                                id: 'call-bad',
                                type: 'function',
                                function: { name: 'echo', arguments: '{bad-json' },
                            },
                            {
                                id: 'call-skip',
                                type: 'other',
                                function: { name: 'ignored', arguments: '{}' },
                            },
                        ],
                    },
                },
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
            },
        }

        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-4')
        const response = await resolved.callLLM(
            [
                {
                    role: 'assistant',
                    content: '',
                    reasoning_content: 'reasoning content',
                    tool_calls: [
                        {
                            id: 'prev-call',
                            type: 'function',
                            function: { name: 'read_file', arguments: '{}' },
                        },
                    ],
                },
                {
                    role: 'tool',
                    content: 'observation',
                    tool_call_id: 'prev-call',
                    name: 'read_file',
                },
                { role: 'user', content: 'continue' },
            ],
            undefined,
            { tools: callOptionsTools, signal },
        )

        expect(response.stop_reason).toBe('tool_use')
        expect(response.reasoning_content).toBe('reasoned')
        expect(response.usage).toEqual({ prompt: 10, completion: 5, total: 15 })
        expect(response.content[0]).toEqual({ type: 'text', text: 'assistant text' })
        expect(response.content).toContainEqual({
            type: 'tool_use',
            id: 'call-ok',
            name: 'echo',
            input: { value: 1 },
        })
        expect(
            response.content.some(
                (item) =>
                    item.type === 'text' &&
                    item.text.startsWith('[tool_use parse error]') &&
                    item.text.includes('{bad-json'),
            ),
        ).toBe(true)

        expect(state.openaiCtorCalls[0]).toEqual({
            apiKey: 'test-key',
            baseURL: 'https://mock.local/v1',
        })

        expect(state.buildRequestCalls).toHaveLength(1)
        const request = state.buildRequestCalls[0] as {
            toolDefinitions: unknown[]
            messages: Array<Record<string, unknown>>
        }
        expect(request.toolDefinitions).toEqual(callOptionsTools)
        expect(request.messages.some((msg) => msg.role === 'tool' && msg.tool_call_id === 'prev-call')).toBe(true)
        expect(
            request.messages.some((msg) => msg.role === 'assistant' && msg.reasoning_content === 'reasoning content'),
        ).toBe(true)

        expect(state.openaiCreateCalls).toHaveLength(1)
        expect((state.openaiCreateCalls[0] as { options: { signal: AbortSignal } }).options.signal).toBe(signal)
    })

    test('returns end_turn when tool_calls has no usable function calls', async () => {
        process.env.MOCK_API_KEY = 'test-key'
        const { withDefaultDeps } = await import('@memo/core/runtime/defaults')

        state.openaiResponse = {
            choices: [
                {
                    message: {
                        content: '',
                        tool_calls: [{ id: 'call-non-fn', type: 'other' }],
                    },
                },
            ],
            usage: {
                prompt_tokens: 1,
                completion_tokens: 0,
                total_tokens: 1,
            },
        }

        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-5')
        const response = await resolved.callLLM([{ role: 'user', content: 'x' } as ChatMessage])
        expect(response.stop_reason).toBe('end_turn')
        expect(response.content).toEqual([])
    })

    test('returns plain text end_turn response with usage', async () => {
        process.env.MOCK_API_KEY = 'test-key'
        const { withDefaultDeps } = await import('@memo/core/runtime/defaults')

        state.openaiResponse = {
            choices: [
                {
                    message: {
                        content: 'plain assistant answer',
                        reasoning_content: '  concise reason  ',
                    },
                },
            ],
            usage: {
                prompt_tokens: 3,
                completion_tokens: 4,
                total_tokens: 7,
            },
        }

        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-5b')
        const response = await resolved.callLLM([{ role: 'user', content: 'x' } as ChatMessage])
        expect(response.stop_reason).toBe('end_turn')
        expect(response.reasoning_content).toBe('concise reason')
        expect(response.content).toEqual([{ type: 'text', text: 'plain assistant answer' }])
        expect(response.usage).toEqual({ prompt: 3, completion: 4, total: 7 })
    })

    test('throws when provider returns non-string content without tool calls', async () => {
        process.env.MOCK_API_KEY = 'test-key'
        const { withDefaultDeps } = await import('@memo/core/runtime/defaults')

        state.openaiResponse = {
            choices: [
                {
                    message: {
                        content: null,
                    },
                },
            ],
            usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
            },
        }

        const resolved = await withDefaultDeps({}, {} as AgentSessionOptions, 'session-6')
        await expect(resolved.callLLM([{ role: 'user', content: 'x' } as ChatMessage])).rejects.toThrow(
            'OpenAI-compatible API returned empty content',
        )
    })
})
