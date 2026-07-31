/** @file Session Hook & Middleware 行为测试。 */
import assert from 'node:assert'
import { describe, test } from 'vitest'
import { createAgentSession, createTokenCounter } from '@memo/core'
import type { ChatMessage, HistoryEvent, LLMResponse, TokenCounter } from '@memo/core'
import type { Tool } from '@memo/tools/router'
import { CONTEXT_COMPACTION_SYSTEM_PROMPT, CONTEXT_SUMMARY_PREFIX } from '@memo/core/runtime/compact_prompt'

const echoTool: Tool = {
    name: 'echo',
    description: 'echo input',
    source: 'native',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    execute: async (input: unknown) => {
        const { text } = input as { text: string }
        return {
            content: [{ type: 'text' as const, text: `echo:${text}` }],
        }
    },
}

const readNoteTool: Tool = {
    name: 'read_note',
    description: 'read note',
    source: 'native',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } } },
    execute: async (input: unknown) => {
        const { topic } = input as { topic: string }
        return {
            content: [{ type: 'text' as const, text: `note:${topic}` }],
        }
    },
}

function toolUseResponse(id: string, name: string, input: unknown, text?: string): LLMResponse {
    return {
        content: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            {
                type: 'tool_use' as const,
                id,
                name,
                input,
            },
        ],
        stop_reason: 'tool_use',
    }
}

function multiToolUseResponse(calls: Array<{ id: string; name: string; input: unknown }>, text?: string): LLMResponse {
    return {
        content: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...calls.map((call) => ({
                type: 'tool_use' as const,
                id: call.id,
                name: call.name,
                input: call.input,
            })),
        ],
        stop_reason: 'tool_use',
    }
}

function endTurnResponse(text: string = 'done'): LLMResponse {
    return {
        content: [{ type: 'text' as const, text }],
        stop_reason: 'end_turn',
    }
}

function createLengthTokenCounter(): TokenCounter {
    return {
        model: 'test-length-counter',
        countText: (text: string) => text.length,
        countMessages: (messages) => messages.reduce((sum, message) => sum + message.content.length, 0),
        dispose: () => {},
    }
}

function hasInvalidToolProtocol(messages: ChatMessage[]): boolean {
    let pendingToolCallIds = new Set<string>()
    for (const message of messages) {
        if (pendingToolCallIds.size > 0) {
            if (message.role !== 'tool') {
                return true
            }
            if (!pendingToolCallIds.has(message.tool_call_id)) {
                return true
            }
            pendingToolCallIds.delete(message.tool_call_id)
            continue
        }

        if (message.role === 'assistant' && message.tool_calls?.length) {
            pendingToolCallIds = new Set(message.tool_calls.map((toolCall) => toolCall.id))
            continue
        }

        if (message.role === 'tool') {
            return true
        }
    }
    return pendingToolCallIds.size > 0
}

describe('session hooks & middleware', () => {
    test('invokes hooks and middlewares in order', async () => {
        const outputs: LLMResponse[] = [toolUseResponse('action-1', 'echo', { text: 'foo' }), endTurnResponse('done')]
        const hookLog: string[] = []
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                // 自动批准所有工具调用
                requestApproval: async () => 'once',
                hooks: {
                    onTurnStart: ({ turn }) => {
                        hookLog.push(`hook:start:${turn}`)
                    },
                    onAction: ({ step, action }) => {
                        hookLog.push(`hook:action:${step}:${action.tool}`)
                    },
                    onObservation: ({ step, tool, observation }) => {
                        hookLog.push(`hook:obs:${step}:${tool}:${observation}`)
                    },
                    onFinal: ({ status, finalText }) => {
                        hookLog.push(`hook:final:${status}:${finalText}`)
                    },
                },
                middlewares: [
                    {
                        onTurnStart: ({ turn }) => {
                            hookLog.push(`mw:start:${turn}`)
                        },
                        onAction: ({ step, action }) => {
                            hookLog.push(`mw:action:${step}:${action.tool}`)
                        },
                        onObservation: ({ step, tool, observation }) => {
                            hookLog.push(`mw:obs:${step}:${tool}:${observation}`)
                        },
                        onFinal: ({ status, finalText }) => {
                            hookLog.push(`mw:final:${status}:${finalText}`)
                        },
                    },
                ],
            },
            {},
        )
        try {
            const result = await session.runTurn('question')
            assert.strictEqual(result.finalText, 'done')
            assert.deepStrictEqual(hookLog, [
                'hook:start:1',
                'mw:start:1',
                'hook:action:0:echo',
                'mw:action:0:echo',
                'hook:obs:0:echo:echo:foo',
                'mw:obs:0:echo:echo:foo',
                'hook:final:ok:done',
                'mw:final:ok:done',
            ])
        } finally {
            await session.close()
        }
    })

    test('executes action from structured tool_use with accompanying text', async () => {
        const outputs: LLMResponse[] = [
            toolUseResponse('action-1', 'echo', { text: 'hi' }, '<think>demo</think>'),
            endTurnResponse('done'),
        ]
        const hookLog: string[] = []
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                // 自动批准所有工具调用
                requestApproval: async () => 'once',
                hooks: {
                    onAction: ({ action }) => {
                        hookLog.push(`action:${action.tool}`)
                    },
                    onFinal: ({ finalText }) => {
                        hookLog.push(`final:${finalText}`)
                    },
                },
            },
            {},
        )
        try {
            const result = await session.runTurn('hi')
            assert.strictEqual(result.finalText, 'done')
            assert.deepStrictEqual(hookLog, ['action:echo', 'final:done'])
        } finally {
            await session.close()
        }
    })

    test('reuses previous assistant text when end_turn arrives empty after tool call', async () => {
        const outputs: LLMResponse[] = [
            toolUseResponse('action-1', 'echo', { text: 'x' }, '这是最终答案'),
            endTurnResponse(''),
        ]
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'once',
            },
            {},
        )
        try {
            const result = await session.runTurn('hi')
            assert.strictEqual(result.status, 'ok')
            assert.strictEqual(result.finalText, '这是最终答案')
        } finally {
            await session.close()
        }
    })

    test('warns after three identical tool calls', async () => {
        const outputs: LLMResponse[] = [
            toolUseResponse('loop-1', 'echo', { text: 'loop' }),
            toolUseResponse('loop-2', 'echo', { text: 'loop' }),
            toolUseResponse('loop-3', 'echo', { text: 'loop' }),
            endTurnResponse('done'),
        ]
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                // 自动批准所有工具调用
                requestApproval: async () => 'session',
            },
            {},
        )
        try {
            const result = await session.runTurn('loop?')
            assert.strictEqual(result.finalText, 'done')
            const systemMessages = session.history.filter((m) => m.role === 'system')
            // 0: initial system prompt, 1: warning
            assert.strictEqual(systemMessages.length, 2)
            assert.ok(systemMessages[1]?.content.includes('连续3次调用同一工具'), 'should insert repetition warning')
        } finally {
            await session.close()
        }
    })

    test('bypasses approval in dangerous mode', async () => {
        const outputs: LLMResponse[] = [toolUseResponse('action-1', 'echo', { text: 'safe' }), endTurnResponse('done')]
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'deny',
            },
            { dangerous: true },
        )
        try {
            const result = await session.runTurn('go')
            assert.strictEqual(result.finalText, 'done')
            assert.strictEqual(result.steps[0]?.observation, 'echo:safe')
        } finally {
            await session.close()
        }
    })

    test('uses risk-based approvals in once tool permission mode', async () => {
        const outputs: LLMResponse[] = [
            toolUseResponse('action-1', 'read_note', { topic: 'memo' }),
            endTurnResponse('done'),
        ]
        let approvalAsked = false
        const session = await createAgentSession(
            {
                tools: { read_note: readNoteTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => {
                    approvalAsked = true
                    return 'deny'
                },
            },
            { toolPermissionMode: 'once' },
        )
        try {
            const result = await session.runTurn('go')
            assert.strictEqual(result.finalText, 'done')
            assert.strictEqual(result.steps[0]?.observation, 'note:memo')
            assert.strictEqual(approvalAsked, false)
        } finally {
            await session.close()
        }
    })

    test('blocks tool calls when tool permission mode is none', async () => {
        const outputs: LLMResponse[] = [
            toolUseResponse('action-1', 'echo', { text: 'blocked' }),
            endTurnResponse('done'),
        ]
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'once',
            },
            { toolPermissionMode: 'none' },
        )
        try {
            const result = await session.runTurn('go')
            assert.strictEqual(result.status, 'error')
            assert.ok(result.finalText.includes('Tool usage is disabled'))
            assert.strictEqual(result.steps[0]?.observation, undefined)
            const deniedToolMessage = session.history.find(
                (message) => message.role === 'tool' && message.tool_call_id === 'action-1',
            )
            assert.ok(deniedToolMessage, 'tool message should be recorded for denied tool_call_id')
            if (deniedToolMessage?.role === 'tool') {
                assert.ok(
                    deniedToolMessage.content.includes('tools are disabled'),
                    'tool message should explain why execution was skipped',
                )
            }
        } finally {
            await session.close()
        }
    })

    test('rejects native tool input via validateInput before execute', async () => {
        const outputs: LLMResponse[] = [toolUseResponse('action-1', 'read_text_file', {}), endTurnResponse('done')]
        const session = await createAgentSession(
            {
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'once',
            },
            {},
        )
        try {
            const result = await session.runTurn('hi')
            assert.strictEqual(result.finalText, 'done')
            assert.ok(result.steps[0]?.observation?.includes('read_text_file invalid input'))
        } finally {
            await session.close()
        }
    })

    test('emits structured tool execution metadata in history events', async () => {
        const events: HistoryEvent[] = []
        const outputs = [
            {
                content: [
                    {
                        type: 'tool_use' as const,
                        id: 'action-1',
                        name: 'echo',
                        input: { text: 'x' },
                    },
                ],
                stop_reason: 'tool_use' as const,
            },
            {
                content: [{ type: 'text' as const, text: 'done' }],
                stop_reason: 'end_turn' as const,
            },
        ]
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [
                    {
                        append: async (event) => {
                            events.push(event)
                        },
                    },
                ],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'once',
            },
            {},
        )
        try {
            const result = await session.runTurn('meta')
            assert.strictEqual(result.finalText, 'done')

            const sessionStart = events.find((event) => event.type === 'session_start')
            assert.ok(sessionStart, 'session_start should exist')
            assert.strictEqual(sessionStart?.meta?.cwd, process.cwd())
            assert.strictEqual(sessionStart?.role, 'system')
            assert.ok(
                typeof sessionStart?.content === 'string' && sessionStart.content.length > 0,
                'session_start should include system prompt content',
            )

            const actionEvent = events.find((event) => event.type === 'action')
            assert.ok(actionEvent, 'action event should exist')
            assert.strictEqual(actionEvent.meta?.phase, 'dispatch')
            assert.strictEqual(actionEvent.meta?.action_id, 'action-1')

            const observationEvent = events.find(
                (event) => event.type === 'observation' && event.meta?.action_id === 'action-1',
            )
            assert.ok(observationEvent, 'observation event should exist')
            assert.strictEqual(observationEvent.meta?.phase, 'result')
            assert.strictEqual(observationEvent.meta?.status, 'success')
            assert.strictEqual(observationEvent.meta?.error_type, undefined)
            assert.strictEqual(typeof observationEvent.meta?.duration_ms, 'number')
        } finally {
            await session.close()
        }
    })

    test('records structured tool call/result messages without json fallback payloads', async () => {
        const outputs: LLMResponse[] = [toolUseResponse('action-1', 'echo', { text: 'x' }), endTurnResponse('done')]
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'once',
            },
            {},
        )
        try {
            const result = await session.runTurn('meta')
            assert.strictEqual(result.finalText, 'done')

            const assistantToolMessage = session.history.find(
                (message) =>
                    message.role === 'assistant' && message.tool_calls?.some((toolCall) => toolCall.id === 'action-1'),
            )
            assert.ok(assistantToolMessage, 'assistant tool_calls message should exist')

            const toolResultMessage = session.history.find(
                (message) => message.role === 'tool' && message.tool_call_id === 'action-1',
            )
            assert.ok(toolResultMessage, 'tool result message should exist')
            if (toolResultMessage?.role === 'tool') {
                assert.strictEqual(toolResultMessage.content, 'echo:x')
                assert.strictEqual(toolResultMessage.name, 'echo')
            }

            assert.ok(
                !session.history.some(
                    (message) => message.role === 'assistant' && message.content.startsWith('{"tool":'),
                ),
                'assistant history should not contain plain-text tool json payloads',
            )
            assert.ok(
                !session.history.some(
                    (message) => message.role === 'user' && message.content.includes('"observation"'),
                ),
                'history should not inject observation json through user messages',
            )
        } finally {
            await session.close()
        }
    })

    test('emits structured rejection metadata in final event', async () => {
        const events: HistoryEvent[] = []
        const outputs = [
            {
                content: [
                    {
                        type: 'tool_use' as const,
                        id: 'reject-1',
                        name: 'echo',
                        input: { text: 'x' },
                    },
                ],
                stop_reason: 'tool_use' as const,
            },
        ]
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [
                    {
                        append: async (event) => {
                            events.push(event)
                        },
                    },
                ],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'deny',
            },
            {},
        )
        try {
            const result = await session.runTurn('meta')
            assert.strictEqual(result.status, 'cancelled')
            const toolMessage = session.history.find(
                (message) => message.role === 'tool' && message.tool_call_id === 'reject-1',
            )
            assert.ok(toolMessage, 'tool message should exist for rejected tool_call_id')
            const finalEvent = [...events].reverse().find((event) => event.type === 'final')
            assert.ok(finalEvent, 'final event should exist')
            assert.strictEqual(finalEvent?.meta?.rejected, true)
            assert.strictEqual(finalEvent?.meta?.phase, 'result')
            assert.strictEqual(finalEvent?.meta?.error_type, 'approval_denied')
            assert.strictEqual(finalEvent?.meta?.action_id, 'reject-1')
            assert.strictEqual(typeof finalEvent?.meta?.duration_ms, 'number')
        } finally {
            await session.close()
        }
    })

    test('records tool messages for all tool_call_ids on fail_fast rejection', async () => {
        const outputs: LLMResponse[] = [
            multiToolUseResponse([
                { id: 'reject-1', name: 'echo', input: { text: 'a' } },
                { id: 'reject-2', name: 'echo', input: { text: 'b' } },
            ]),
        ]
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'deny',
            },
            {},
        )

        try {
            const result = await session.runTurn('meta')
            assert.strictEqual(result.status, 'cancelled')

            const first = session.history.find(
                (message) => message.role === 'tool' && message.tool_call_id === 'reject-1',
            )
            const second = session.history.find(
                (message) => message.role === 'tool' && message.tool_call_id === 'reject-2',
            )
            assert.ok(first, 'first tool_call_id should have a matching tool message')
            assert.ok(second, 'second tool_call_id should have a matching tool message')
            if (second?.role === 'tool') {
                assert.ok(
                    second.content.includes('Skipped tool execution after previous rejection'),
                    'missing tool execution should be represented as skipped observation',
                )
            }
        } finally {
            await session.close()
        }
    })

    test('fails with model_protocol_error when model emits plain-text tool json', async () => {
        const events: HistoryEvent[] = []
        const outputs: LLMResponse[] = [endTurnResponse('{"tool":"echo","input":{"text":"x"}}')]
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [
                    {
                        append: async (event) => {
                            events.push(event)
                        },
                    },
                ],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'once',
            },
            {},
        )
        try {
            const result = await session.runTurn('recover')
            assert.strictEqual(result.status, 'error')
            assert.ok(result.finalText.includes('Model protocol error'))

            const finalEvent = [...events].reverse().find((event) => event.type === 'final')
            assert.ok(finalEvent, 'final event should exist')
            assert.strictEqual(finalEvent?.meta?.error_type, 'model_protocol_error')
            assert.strictEqual(finalEvent?.meta?.protocol_violation_count, 1)

            const turnEnd = [...events].reverse().find((event) => event.type === 'turn_end')
            assert.ok(turnEnd, 'turn_end should exist')
            assert.strictEqual(turnEnd?.meta?.status, 'error')
            assert.strictEqual(turnEnd?.meta?.protocol_violation_count, 1)
        } finally {
            await session.close()
        }
    })

    test('falls back to generic final error when model returns no actionable content', async () => {
        const outputs: LLMResponse[] = [
            {
                content: [],
                stop_reason: 'stop_sequence',
            },
        ]
        const session = await createAgentSession(
            {
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'once',
            },
            {},
        )
        try {
            const result = await session.runTurn('empty response')
            expect(result.status).toBe('error')
            expect(result.finalText).toBe('Unable to produce a final answer. Please retry or adjust the request.')
            expect(result.errorMessage).toBe(result.finalText)
            const last = session.history[session.history.length - 1]
            expect(last?.role).toBe('assistant')
            expect(last?.content).toBe(result.finalText)
        } finally {
            await session.close()
        }
    })

    test('does not treat unknown tool json text as protocol violation', async () => {
        const outputs: LLMResponse[] = [endTurnResponse('{"tool":"unknown","input":{}}')]
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'once',
            },
            {},
        )
        try {
            const result = await session.runTurn('unknown')
            assert.strictEqual(result.status, 'ok')
            assert.strictEqual(result.finalText, '{"tool":"unknown","input":{}}')
        } finally {
            await session.close()
        }
    })

    test('emits context usage hooks at turn start and each step', async () => {
        const outputs: LLMResponse[] = [toolUseResponse('action-1', 'echo', { text: 'x' }), endTurnResponse('done')]
        const phases: string[] = []

        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                requestApproval: async () => 'once',
                hooks: {
                    onContextUsage: ({ phase, step }) => {
                        phases.push(`${phase}:${step}`)
                    },
                },
            },
            { contextWindow: 1_000_000 },
        )
        try {
            const result = await session.runTurn('question')
            assert.strictEqual(result.finalText, 'done')
            assert.ok(phases.includes('turn_start:0'))
            assert.ok(phases.includes('step_start:0'))
            assert.ok(phases.includes('step_start:1'))
        } finally {
            await session.close()
        }
    })

    test('auto compaction is triggered at threshold and runs at most once per turn', async () => {
        const outputs: LLMResponse[] = [
            toolUseResponse('action-1', 'echo', { text: 'x' }),
            toolUseResponse('action-2', 'echo', { text: 'y' }),
            endTurnResponse('done'),
        ]
        let autoCompactionCalls = 0

        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async (messages, _onChunk, options) => {
                    const isCompactionCall =
                        messages[0]?.role === 'system' &&
                        messages[0].content === CONTEXT_COMPACTION_SYSTEM_PROMPT &&
                        Array.isArray(options?.tools) &&
                        options.tools.length === 0
                    if (isCompactionCall) {
                        autoCompactionCalls += 1
                        return endTurnResponse('checkpoint')
                    }
                    return outputs.shift() ?? endTurnResponse('done')
                },
                loadPrompt: async () => 'sys',
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
                requestApproval: async () => 'once',
            },
            {
                contextWindow: 10_000,
                autoCompactThresholdPercent: 5,
            },
        )
        try {
            const result = await session.runTurn('auto compact please '.repeat(20))
            assert.strictEqual(result.status, 'prompt_limit')
            assert.strictEqual(autoCompactionCalls, 1)
        } finally {
            await session.close()
        }
    })

    test('manual and auto compaction share the same engine', async () => {
        let compactionCalls = 0
        const compactedReasons: string[] = []

        const session = await createAgentSession(
            {
                callLLM: async (messages, _onChunk, options) => {
                    const isCompactionCall =
                        messages[0]?.role === 'system' &&
                        messages[0].content === CONTEXT_COMPACTION_SYSTEM_PROMPT &&
                        Array.isArray(options?.tools) &&
                        options.tools.length === 0
                    if (isCompactionCall) {
                        compactionCalls += 1
                        return endTurnResponse(`summary-${compactionCalls}`)
                    }
                    return endTurnResponse('done')
                },
                loadPrompt: async () => 'sys',
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
                hooks: {
                    onContextCompacted: ({ reason }) => {
                        compactedReasons.push(reason)
                    },
                },
            },
            {
                contextWindow: 10_000,
                autoCompactThresholdPercent: 5,
            },
        )

        try {
            const runResult = await session.runTurn('trigger auto compaction '.repeat(20))
            assert.strictEqual(runResult.status, 'prompt_limit')

            const manualResult = await session.compactHistory('manual')
            assert.strictEqual(manualResult.status, 'success')

            assert.strictEqual(compactionCalls, 2)
            assert.ok(compactedReasons.includes('auto'))
            assert.ok(compactedReasons.includes('manual'))
        } finally {
            await session.close()
        }
    })

    test('compaction failure keeps history intact and falls back to prompt_limit', async () => {
        const compactStatuses: string[] = []
        let regularLLMCalls = 0

        const session = await createAgentSession(
            {
                callLLM: async (messages, _onChunk, options) => {
                    const isCompactionCall =
                        messages[0]?.role === 'system' &&
                        messages[0].content === CONTEXT_COMPACTION_SYSTEM_PROMPT &&
                        Array.isArray(options?.tools) &&
                        options.tools.length === 0
                    if (isCompactionCall) {
                        throw new Error('compaction failed')
                    }
                    regularLLMCalls += 1
                    return endTurnResponse('unexpected')
                },
                loadPrompt: async () => 'sys',
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
                hooks: {
                    onContextCompacted: ({ status }) => {
                        compactStatuses.push(status)
                    },
                },
            },
            {
                contextWindow: 200,
                autoCompactThresholdPercent: 50,
            },
        )

        try {
            const result = await session.runTurn('this input is intentionally long enough '.repeat(8))
            assert.strictEqual(result.status, 'prompt_limit')
            assert.ok(result.finalText.includes('Context tokens'))
            assert.ok(compactStatuses.includes('failed'))
            assert.strictEqual(regularLLMCalls, 0)
            assert.strictEqual(
                session.history.some(
                    (message) => message.role === 'user' && message.content.startsWith(`${CONTEXT_SUMMARY_PREFIX}\n`),
                ),
                false,
            )
        } finally {
            await session.close()
        }
    })

    test('manual compaction skips when there is no non-system history', async () => {
        let llmCalls = 0
        const compactStatuses: string[] = []
        const session = await createAgentSession(
            {
                callLLM: async () => {
                    llmCalls += 1
                    return endTurnResponse('should-not-run')
                },
                loadPrompt: async () => 'sys',
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
                hooks: {
                    onContextCompacted: ({ status }) => {
                        compactStatuses.push(status)
                    },
                },
            },
            { contextWindow: 120_000 },
        )

        try {
            const result = await session.compactHistory('manual')
            assert.strictEqual(result.status, 'skipped')
            assert.strictEqual(llmCalls, 0)
            assert.ok(compactStatuses.includes('skipped'))
            assert.strictEqual(session.history.length, 1)
            assert.strictEqual(session.history[0]?.role, 'system')
        } finally {
            await session.close()
        }
    })

    test('manual compaction rebuilds history with user-only context and summary', async () => {
        const assistantToolCall = {
            id: 'call_function_l5suo7l5etii_1',
            type: 'function' as const,
            function: {
                name: 'exec_command',
                arguments: '{}',
            },
        }
        let sawCompactionCall = false

        const session = await createAgentSession(
            {
                callLLM: async (messages, _onChunk, options) => {
                    const isCompactionCall =
                        messages[0]?.role === 'system' &&
                        messages[0].content === CONTEXT_COMPACTION_SYSTEM_PROMPT &&
                        Array.isArray(options?.tools) &&
                        options.tools.length === 0
                    if (isCompactionCall) {
                        sawCompactionCall = true
                        return endTurnResponse('compacted summary')
                    }

                    assert.strictEqual(hasInvalidToolProtocol(messages), false)
                    return endTurnResponse('ok')
                },
                loadPrompt: async () => 'sys',
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
            },
            { contextWindow: 120_000 },
        )

        try {
            session.history.push(
                { role: 'user', content: 'u1' },
                { role: 'assistant', content: '', tool_calls: [assistantToolCall] },
                {
                    role: 'tool',
                    content: 'tool-result',
                    tool_call_id: assistantToolCall.id,
                    name: 'exec_command',
                },
                { role: 'assistant', content: 'a1' },
                { role: 'user', content: 'u2' },
                { role: 'assistant', content: 'a2' },
                { role: 'user', content: 'u3' },
                { role: 'assistant', content: 'a3' },
                { role: 'user', content: 'u4' },
                { role: 'assistant', content: 'a4' },
                { role: 'user', content: 'u5' },
                { role: 'assistant', content: 'a5' },
                { role: 'user', content: 'u6' },
                { role: 'assistant', content: 'a6' },
            )

            const compactResult = await session.compactHistory('manual')
            assert.strictEqual(compactResult.status, 'success')
            assert.strictEqual(sawCompactionCall, true)
            assert.strictEqual(hasInvalidToolProtocol(session.history), false)
            assert.ok(
                session.history.some(
                    (message) => message.role === 'user' && message.content.startsWith(`${CONTEXT_SUMMARY_PREFIX}\n`),
                ),
                'summary message should be preserved in compacted history',
            )
            assert.strictEqual(
                session.history.some((message) => message.role === 'tool'),
                false,
                'compacted history should drop tool result messages',
            )
            assert.strictEqual(
                session.history.some(
                    (message) =>
                        message.role === 'assistant' &&
                        Array.isArray(message.tool_calls) &&
                        message.tool_calls.length > 0,
                ),
                false,
                'compacted history should drop assistant tool-call messages',
            )

            const turnResult = await session.runTurn('continue')
            assert.strictEqual(turnResult.status, 'ok')
            assert.strictEqual(turnResult.finalText, 'ok')
        } finally {
            await session.close()
        }
    })

    test('manual compaction keeps recent user context within token budget', async () => {
        const hugeUserMessage = 'a'.repeat(25_000)
        const session = await createAgentSession(
            {
                callLLM: async (messages, _onChunk, options) => {
                    const isCompactionCall =
                        messages[0]?.role === 'system' &&
                        messages[0].content === CONTEXT_COMPACTION_SYSTEM_PROMPT &&
                        Array.isArray(options?.tools) &&
                        options.tools.length === 0
                    if (isCompactionCall) {
                        return endTurnResponse('summary-budget')
                    }
                    return endTurnResponse('ok')
                },
                loadPrompt: async () => 'sys',
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
            },
            { contextWindow: 120_000 },
        )

        try {
            session.history.push({ role: 'user', content: 'older-user-message' })
            session.history.push({ role: 'user', content: hugeUserMessage })

            const compactResult = await session.compactHistory('manual')
            assert.strictEqual(compactResult.status, 'success')
            assert.strictEqual(session.history[0]?.role, 'system')
            assert.strictEqual(session.history.length, 3)

            const retainedUserMessage = session.history[1]
            assert.strictEqual(retainedUserMessage?.role, 'user')
            assert.strictEqual(retainedUserMessage?.content.length, 20_000)
            assert.ok(retainedUserMessage?.content.startsWith('a'))

            const summaryMessage = session.history[2]
            assert.strictEqual(summaryMessage?.role, 'user')
            assert.ok(summaryMessage?.content.startsWith(`${CONTEXT_SUMMARY_PREFIX}\n`))
        } finally {
            await session.close()
        }
    })

    test('manual compaction strips think tags and collapses extra blank lines in summary', async () => {
        const session = await createAgentSession(
            {
                callLLM: async (messages, _onChunk, options) => {
                    const isCompactionCall =
                        messages[0]?.role === 'system' &&
                        messages[0].content === CONTEXT_COMPACTION_SYSTEM_PROMPT &&
                        Array.isArray(options?.tools) &&
                        options.tools.length === 0
                    if (isCompactionCall) {
                        return endTurnResponse('<think>internal</think>\n\nsummary\n\n\nnext')
                    }
                    return endTurnResponse('ok')
                },
                loadPrompt: async () => 'sys',
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
            },
            { contextWindow: 120_000 },
        )

        try {
            session.history.push({ role: 'user', content: 'hello' })
            const compactResult = await session.compactHistory('manual')
            assert.strictEqual(compactResult.status, 'success')
            assert.strictEqual(compactResult.summary?.includes('<think>'), false)
            assert.strictEqual(compactResult.summary, 'summary\n\nnext')

            const summaryMessage = session.history[session.history.length - 1]
            assert.strictEqual(summaryMessage?.role, 'user')
            assert.ok(summaryMessage?.content.endsWith('summary\n\nnext'))
        } finally {
            await session.close()
        }
    })

    test('manual compaction filters old summary messages from retained user context', async () => {
        const oldSummary = `${CONTEXT_SUMMARY_PREFIX}\nold summary`
        const session = await createAgentSession(
            {
                callLLM: async (messages, _onChunk, options) => {
                    const isCompactionCall =
                        messages[0]?.role === 'system' &&
                        messages[0].content === CONTEXT_COMPACTION_SYSTEM_PROMPT &&
                        Array.isArray(options?.tools) &&
                        options.tools.length === 0
                    if (isCompactionCall) {
                        return endTurnResponse('new summary')
                    }
                    return endTurnResponse('ok')
                },
                loadPrompt: async () => 'sys',
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
            },
            { contextWindow: 120_000 },
        )

        try {
            session.history.push({ role: 'user', content: oldSummary })
            session.history.push({ role: 'user', content: 'latest user request' })

            const result = await session.compactHistory('manual')
            assert.strictEqual(result.status, 'success')

            const summaryMessages = session.history.filter(
                (message) => message.role === 'user' && message.content.startsWith(`${CONTEXT_SUMMARY_PREFIX}\n`),
            )
            assert.strictEqual(summaryMessages.length, 1)
            assert.ok(summaryMessages[0]?.content.endsWith('new summary'))
            assert.strictEqual(
                session.history.some((message) => message.content === oldSummary),
                false,
            )
        } finally {
            await session.close()
        }
    })

    test('close swallows sink flush errors', async () => {
        const errors: string[] = []
        const originalError = console.error
        console.error = (message?: unknown) => {
            errors.push(String(message))
        }

        const session = await createAgentSession(
            {
                callLLM: async () => endTurnResponse('ok'),
                historySinks: [
                    {
                        append: async () => {},
                        flush: async () => {
                            throw new Error('flush failed')
                        },
                    },
                ],
                tokenCounter: createLengthTokenCounter(),
            },
            {},
        )

        try {
            await session.close()
            assert.ok(errors.some((message) => message.includes('History flush failed: flush failed')))
        } finally {
            console.error = originalError
        }
    })

    test('close prefers sink.close over sink.flush', async () => {
        let closeCalls = 0
        let flushCalls = 0
        const session = await createAgentSession(
            {
                callLLM: async () => endTurnResponse('ok'),
                historySinks: [
                    {
                        append: async () => {},
                        close: async () => {
                            closeCalls += 1
                        },
                        flush: async () => {
                            flushCalls += 1
                        },
                    },
                ],
                tokenCounter: createLengthTokenCounter(),
            },
            {},
        )

        await session.close()
        assert.strictEqual(closeCalls, 1)
        assert.strictEqual(flushCalls, 0)
    })

    test('close calls sink.flush when sink.close is absent', async () => {
        let flushCalls = 0
        const session = await createAgentSession(
            {
                callLLM: async () => endTurnResponse('ok'),
                historySinks: [
                    {
                        append: async () => {},
                        flush: async () => {
                            flushCalls += 1
                        },
                    },
                ],
                tokenCounter: createLengthTokenCounter(),
            },
            {},
        )

        await session.close()
        assert.strictEqual(flushCalls, 1)
    })

    test('listToolNames returns registered tools', async () => {
        const session = await createAgentSession(
            {
                tools: { echo: echoTool, read_note: readNoteTool },
                callLLM: async () => endTurnResponse('ok'),
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
            },
            {},
        )
        try {
            const names = session.listToolNames().sort()
            assert.ok(names.includes('echo'))
            assert.ok(names.includes('read_note'))
        } finally {
            await session.close()
        }
    })

    test('cancelCurrentTurn is a no-op when turn is idle', async () => {
        const session = await createAgentSession(
            {
                callLLM: async () => endTurnResponse('ok'),
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
            },
            {},
        )
        try {
            session.cancelCurrentTurn()
            assert.strictEqual(session.history.length, 1)
        } finally {
            await session.close()
        }
    })

    test('cancelCurrentTurn aborts an in-flight llm request', async () => {
        const session = await createAgentSession(
            {
                callLLM: async (_messages, _onChunk, options) =>
                    new Promise((_, reject) => {
                        const abortError = new Error('aborted')
                        abortError.name = 'AbortError'

                        const signal = options?.signal
                        if (!signal) {
                            reject(new Error('missing abort signal'))
                            return
                        }
                        if (signal.aborted) {
                            reject(abortError)
                            return
                        }
                        signal.addEventListener(
                            'abort',
                            () => {
                                reject(abortError)
                            },
                            { once: true },
                        )
                    }),
                historySinks: [],
                tokenCounter: createLengthTokenCounter(),
            },
            {},
        )

        try {
            const turnPromise = session.runTurn('cancel me')
            await new Promise((resolve) => setTimeout(resolve, 10))
            session.cancelCurrentTurn()
            const result = await turnPromise
            assert.strictEqual(result.status, 'cancelled')
            assert.strictEqual(result.errorMessage, 'Turn cancelled')
        } finally {
            await session.close()
        }
    })

    test('sets and persists session title from first user prompt', async () => {
        const events: HistoryEvent[] = []
        const generatedTitles: string[] = []
        const calls: Array<{ options: unknown }> = []
        const outputs: LLMResponse[] = [endTurnResponse('done')]

        const session = await createAgentSession(
            {
                callLLM: async (_messages, _onChunk, options) => {
                    calls.push({ options })
                    return outputs.shift() ?? endTurnResponse('done')
                },
                historySinks: [
                    {
                        append: async (event) => {
                            events.push(event)
                        },
                    },
                ],
                tokenCounter: createTokenCounter('cl100k_base'),
                hooks: {
                    onTitleGenerated: ({ title }) => {
                        generatedTitles.push(title)
                    },
                },
            },
            {},
        )
        try {
            const result = await session.runTurn('Help me create a REST API with Express.js')
            assert.strictEqual(result.finalText, 'done')
            assert.strictEqual(session.title, 'Help me create a REST API with Express.js')

            const titleEvent = events.find((event) => event.type === 'session_title')
            assert.ok(titleEvent, 'session_title event should exist')
            assert.strictEqual(titleEvent?.content, 'Help me create a REST API with Express.js')
            assert.strictEqual(titleEvent?.meta?.source, 'first_prompt')
            assert.deepStrictEqual(generatedTitles, ['Help me create a REST API with Express.js'])
            assert.strictEqual(calls.length, 1, 'should not issue extra LLM call for title')
        } finally {
            await session.close()
        }
    })

    test('emits session title only once across multiple turns', async () => {
        const events: HistoryEvent[] = []
        const outputs: LLMResponse[] = [endTurnResponse('done'), endTurnResponse('done-again')]

        const session = await createAgentSession(
            {
                callLLM: async () => outputs.shift() ?? endTurnResponse('done'),
                historySinks: [
                    {
                        append: async (event) => {
                            events.push(event)
                        },
                    },
                ],
                tokenCounter: createTokenCounter('cl100k_base'),
            },
            {},
        )
        try {
            const first = await session.runTurn('Build migration plan for v2 release')
            assert.strictEqual(first.finalText, 'done')
            assert.strictEqual(session.title, 'Build migration plan for v2 release')

            const second = await session.runTurn('continue')
            assert.strictEqual(second.finalText, 'done-again')

            const titleEvents = events.filter((event) => event.type === 'session_title')
            assert.strictEqual(titleEvents.length, 1, 'session_title should be emitted once')
            assert.strictEqual(titleEvents[0]?.meta?.source, 'first_prompt')
        } finally {
            await session.close()
        }
    })
})
