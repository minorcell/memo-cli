import { describe, expect, test, vi } from 'vitest'
import type {
    AgentSessionDeps,
    TurnStartHookPayload,
    ActionHookPayload,
    ObservationHookPayload,
    FinalHookPayload,
    ChatMessage,
    AssistantToolCall,
} from '@memo/core/types'
import { buildHookRunners, runHook, snapshotHistory } from '@memo/core/runtime/hooks'

describe('buildHookRunners', () => {
    test('creates empty hook map when no hooks provided', () => {
        const deps: AgentSessionDeps = {}
        const runners = buildHookRunners(deps)

        expect(runners).toEqual({
            onTurnStart: [],
            onContextUsage: [],
            onContextCompacted: [],
            onAction: [],
            onObservation: [],
            onFinal: [],
            onApprovalRequest: [],
            onApprovalResponse: [],
            onTitleGenerated: [],
        })
    })

    test('registers single hook from deps.hooks', () => {
        const onTurnStart = vi.fn()
        const deps: AgentSessionDeps = {
            hooks: { onTurnStart },
        }

        const runners = buildHookRunners(deps)

        expect(runners.onTurnStart).toHaveLength(1)
        expect(runners.onTurnStart[0]).toBe(onTurnStart)
    })

    test('registers multiple hooks from deps.hooks', () => {
        const onTurnStart = vi.fn()
        const onAction = vi.fn()
        const onFinal = vi.fn()
        const deps: AgentSessionDeps = {
            hooks: { onTurnStart, onAction, onFinal },
        }

        const runners = buildHookRunners(deps)

        expect(runners.onTurnStart).toHaveLength(1)
        expect(runners.onAction).toHaveLength(1)
        expect(runners.onFinal).toHaveLength(1)
    })

    test('registers hooks from single middleware', () => {
        const middleware = {
            name: 'test-middleware',
            onAction: vi.fn(),
            onObservation: vi.fn(),
        }
        const deps: AgentSessionDeps = {
            middlewares: [middleware],
        }

        const runners = buildHookRunners(deps)

        expect(runners.onAction).toHaveLength(1)
        expect(runners.onAction[0]).toBe(middleware.onAction)
        expect(runners.onObservation).toHaveLength(1)
    })

    test('registers hooks from multiple middlewares', () => {
        const middleware1 = {
            onTurnStart: vi.fn(),
            onAction: vi.fn(),
        }
        const middleware2 = {
            onAction: vi.fn(),
            onFinal: vi.fn(),
        }
        const deps: AgentSessionDeps = {
            middlewares: [middleware1, middleware2],
        }

        const runners = buildHookRunners(deps)

        expect(runners.onTurnStart).toHaveLength(1)
        expect(runners.onAction).toHaveLength(2)
        expect(runners.onFinal).toHaveLength(1)
    })

    test('merges hooks from both deps.hooks and middlewares', () => {
        const hookHandler = vi.fn()
        const middleware = {
            onAction: vi.fn(),
            onFinal: vi.fn(),
        }
        const deps: AgentSessionDeps = {
            hooks: { onTurnStart: hookHandler },
            middlewares: [middleware],
        }

        const runners = buildHookRunners(deps)

        expect(runners.onTurnStart).toHaveLength(1)
        expect(runners.onAction).toHaveLength(1)
        expect(runners.onFinal).toHaveLength(1)
    })
})

describe('runHook', () => {
    test('does nothing when no handlers registered', async () => {
        const runners = {
            onTurnStart: [],
            onContextUsage: [],
            onContextCompacted: [],
            onAction: [],
            onObservation: [],
            onFinal: [],
            onApprovalRequest: [],
            onApprovalResponse: [],
            onTitleGenerated: [],
        }
        const payload: TurnStartHookPayload = {
            sessionId: 's1',
            turn: 1,
            input: 'hello',
            history: [],
        }

        await expect(runHook(runners, 'onTurnStart', payload)).resolves.toBeUndefined()
    })

    test('executes single handler', async () => {
        const handler = vi.fn()
        const runners = {
            onTurnStart: [handler],
            onContextUsage: [],
            onContextCompacted: [],
            onAction: [],
            onObservation: [],
            onFinal: [],
            onApprovalRequest: [],
            onApprovalResponse: [],
            onTitleGenerated: [],
        }
        const payload: TurnStartHookPayload = {
            sessionId: 's1',
            turn: 1,
            input: 'hello',
            history: [],
        }

        await runHook(runners, 'onTurnStart', payload)

        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveBeenCalledWith(payload)
    })

    test('executes multiple handlers in order', async () => {
        const order: number[] = []
        const handler1 = vi.fn(() => {
            order.push(1)
        })
        const handler2 = vi.fn(() => {
            order.push(2)
        })
        const handler3 = vi.fn(() => {
            order.push(3)
        })
        const runners = {
            onAction: [handler1, handler2, handler3],
            onTurnStart: [],
            onContextUsage: [],
            onContextCompacted: [],
            onObservation: [],
            onFinal: [],
            onApprovalRequest: [],
            onApprovalResponse: [],
            onTitleGenerated: [],
        }
        const payload: ActionHookPayload = {
            sessionId: 's1',
            turn: 1,
            step: 1,
            action: { tool: 'test', input: {} },
            history: [],
        }

        await runHook(runners, 'onAction', payload)

        expect(handler1).toHaveBeenCalledTimes(1)
        expect(handler2).toHaveBeenCalledTimes(1)
        expect(handler3).toHaveBeenCalledTimes(1)
        expect(order).toEqual([1, 2, 3])
    })

    test('handles sync and async handlers', async () => {
        const syncHandler = vi.fn()
        const asyncHandler = vi.fn(async () => {
            await Promise.resolve()
        })
        const runners = {
            onFinal: [syncHandler, asyncHandler],
            onTurnStart: [],
            onContextUsage: [],
            onContextCompacted: [],
            onAction: [],
            onObservation: [],
            onApprovalRequest: [],
            onApprovalResponse: [],
            onTitleGenerated: [],
        }
        const payload: FinalHookPayload = {
            sessionId: 's1',
            turn: 1,
            finalText: 'done',
            status: 'ok',
            turnUsage: { prompt: 10, completion: 5, total: 15 },
            steps: [],
        }

        await runHook(runners, 'onFinal', payload)

        expect(syncHandler).toHaveBeenCalled()
        expect(asyncHandler).toHaveBeenCalled()
    })

    test('catches and logs handler errors without throwing', async () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const errorHandler = vi.fn(() => {
            throw new Error('Handler error')
        })
        const successHandler = vi.fn()
        const runners = {
            onObservation: [errorHandler, successHandler],
            onTurnStart: [],
            onContextUsage: [],
            onContextCompacted: [],
            onAction: [],
            onFinal: [],
            onApprovalRequest: [],
            onApprovalResponse: [],
            onTitleGenerated: [],
        }
        const payload: ObservationHookPayload = {
            sessionId: 's1',
            turn: 1,
            step: 1,
            tool: 'test',
            observation: 'result',
            history: [],
        }

        await runHook(runners, 'onObservation', payload)

        expect(consoleWarnSpy).toHaveBeenCalledWith('Hook onObservation failed: Handler error')
        expect(successHandler).toHaveBeenCalled()
        consoleWarnSpy.mockRestore()
    })
})

describe('snapshotHistory', () => {
    test('returns empty array for empty history', () => {
        const history: ChatMessage[] = []
        const snapshot = snapshotHistory(history)
        expect(snapshot).toEqual([])
    })

    test('creates deep copy of user messages', () => {
        const history: ChatMessage[] = [{ role: 'user', content: 'hello' }]
        const snapshot = snapshotHistory(history)

        expect(snapshot).not.toBe(history)
        expect(snapshot[0]).not.toBe(history[0])
        expect(snapshot[0]).toEqual(history[0])
    })

    test('creates deep copy of system messages', () => {
        const history: ChatMessage[] = [{ role: 'system', content: 'system prompt' }]
        const snapshot = snapshotHistory(history)

        expect(snapshot[0]).not.toBe(history[0])
        expect(snapshot[0]).toEqual(history[0])
    })

    test('creates deep copy of assistant messages without tool_calls', () => {
        const history: ChatMessage[] = [{ role: 'assistant', content: 'response' }]
        const snapshot = snapshotHistory(history)

        expect(snapshot[0]).not.toBe(history[0])
        expect(snapshot[0]).toEqual(history[0])
    })

    test('deeply copies tool_calls function objects', () => {
        const toolCall: AssistantToolCall = {
            id: 'call-1',
            type: 'function',
            function: {
                name: 'test_tool',
                arguments: '{"arg": "value"}',
            },
        }
        const history: ChatMessage[] = [{ role: 'assistant', content: '', tool_calls: [toolCall] }]
        const snapshot = snapshotHistory(history)

        expect(snapshot).not.toBe(history)
        const histMsg0 = history[0] as { tool_calls: AssistantToolCall[] }
        const snapMsg0 = snapshot[0] as { tool_calls: AssistantToolCall[] }
        expect(snapMsg0.tool_calls).not.toBe(histMsg0.tool_calls)
        expect(snapMsg0.tool_calls[0]).not.toBe(histMsg0.tool_calls[0])
        expect(snapMsg0.tool_calls[0]?.function).not.toBe(histMsg0.tool_calls[0]?.function)
        expect(snapMsg0.tool_calls[0]?.function).toEqual(histMsg0.tool_calls[0]?.function)
    })

    test('handles multiple tool_calls', () => {
        const history: ChatMessage[] = [
            {
                role: 'assistant',
                content: 'using tools',
                tool_calls: [
                    {
                        id: 'call-1',
                        type: 'function',
                        function: { name: 'tool1', arguments: '{}' },
                    },
                    {
                        id: 'call-2',
                        type: 'function',
                        function: { name: 'tool2', arguments: '{}' },
                    },
                ],
            },
        ]
        const snapshot = snapshotHistory(history)

        const snapMsg0 = snapshot[0] as { tool_calls: AssistantToolCall[] }
        expect(snapMsg0.tool_calls).toHaveLength(2)
        const histMsg0 = history[0] as { tool_calls: AssistantToolCall[] }
        expect(snapMsg0.tool_calls[0]).not.toBe(histMsg0.tool_calls[0])
        expect(snapMsg0.tool_calls[1]).not.toBe(histMsg0.tool_calls[1])
    })

    test('creates deep copy of tool messages', () => {
        const history: ChatMessage[] = [
            {
                role: 'tool',
                content: 'tool result',
                tool_call_id: 'call-1',
                name: 'test_tool',
            },
        ]
        const snapshot = snapshotHistory(history)

        expect(snapshot[0]).not.toBe(history[0])
        expect(snapshot[0]).toEqual(history[0])
    })

    test('preserves mixed message types', () => {
        const history: ChatMessage[] = [
            { role: 'system', content: 'system' },
            { role: 'user', content: 'hello' },
            {
                role: 'assistant',
                content: 'response',
                tool_calls: [
                    {
                        id: 'call-1',
                        type: 'function',
                        function: { name: 'tool', arguments: '{}' },
                    },
                ],
            },
            {
                role: 'tool',
                content: 'result',
                tool_call_id: 'call-1',
            },
        ]
        const snapshot = snapshotHistory(history)

        expect(snapshot).toHaveLength(4)
        expect(snapshot[0]?.role).toBe('system')
        expect(snapshot[1]?.role).toBe('user')
        expect(snapshot[2]?.role).toBe('assistant')
        expect(snapshot[3]?.role).toBe('tool')
        const histMsg2 = history[2] as { tool_calls: AssistantToolCall[] }
        const snapMsg2 = snapshot[2] as { tool_calls: AssistantToolCall[] }
        expect(snapMsg2.tool_calls[0]?.function).not.toBe(histMsg2.tool_calls[0]?.function)
    })
})
