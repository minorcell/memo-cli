import assert from 'node:assert'
import { describe, test } from 'vitest'
import type { LanguageModelUsage } from '@memo/core'
import { chatTimelineReducer, createInitialTimelineState } from './chatTimeline'

describe('chatTimelineReducer', () => {
    test('creates turn and appends chunks', () => {
        let state = createInitialTimelineState()

        state = chatTimelineReducer(state, {
            type: 'turn_start',
            turn: 1,
            input: 'hello',
            promptTokens: 30,
        })

        state = chatTimelineReducer(state, {
            type: 'assistant_chunk',
            turn: 1,
            step: 0,
            chunk: 'world',
        })

        const turn = state.turns[0]
        assert.ok(turn)
        assert.strictEqual(turn?.userInput, 'hello')
        assert.strictEqual(turn?.steps[0]?.assistantText, 'world')
    })

    test('writes system messages with sequence', () => {
        let state = createInitialTimelineState()

        state = chatTimelineReducer(state, {
            type: 'append_system_message',
            title: 'Info',
            content: 'hello',
        })

        assert.strictEqual(state.systemMessages.length, 1)
        assert.strictEqual(state.systemMessages[0]?.sequence, 1)
    })

    test('upserts structured agent activity by agent id', () => {
        let state = createInitialTimelineState()
        const base = {
            agentId: 'agent-1',
            agentPath: '/root/review',
            taskName: 'review',
            status: 'running' as const,
            updatedAt: '2026-01-01T00:00:00.000Z',
        }
        state = chatTimelineReducer(state, { type: 'agent_status', activity: base })
        state = chatTimelineReducer(state, {
            type: 'agent_status',
            activity: { ...base, status: 'completed', lastMessage: 'done' },
        })
        assert.deepStrictEqual(state.agents, [{ ...base, status: 'completed', lastMessage: 'done' }])
    })

    test('updates context prompt tokens at step granularity', () => {
        let state = createInitialTimelineState()

        state = chatTimelineReducer(state, {
            type: 'turn_start',
            turn: 1,
            input: 'hello',
            promptTokens: 10,
        })

        state = chatTimelineReducer(state, {
            type: 'context_usage',
            turn: 1,
            step: 0,
            promptTokens: 42,
            phase: 'step_start',
        })

        const turn = state.turns[0]
        assert.ok(turn)
        assert.strictEqual(turn?.contextPromptTokens, 42)
        assert.strictEqual(turn?.steps[0]?.contextPromptTokens, 42)
    })

    test('accumulates streaming reasoning chunks into streamingThinking', () => {
        let state = createInitialTimelineState()

        state = chatTimelineReducer(state, { type: 'turn_start', turn: 1, input: 'hi' })
        state = chatTimelineReducer(state, { type: 'reasoning_chunk', turn: 1, step: 0, chunk: 'think ' })
        state = chatTimelineReducer(state, { type: 'reasoning_chunk', turn: 1, step: 0, chunk: 'more' })

        assert.strictEqual(state.turns[0]?.steps[0]?.streamingThinking, 'think more')
        assert.strictEqual(state.turns[0]?.steps[0]?.assistantText, '')
    })

    test('tool_action with full thinking drops the live stream', () => {
        let state = createInitialTimelineState()

        state = chatTimelineReducer(state, { type: 'turn_start', turn: 1, input: 'hi' })
        state = chatTimelineReducer(state, { type: 'reasoning_chunk', turn: 1, step: 0, chunk: 'live trace' })
        state = chatTimelineReducer(state, {
            type: 'tool_action',
            turn: 1,
            step: 0,
            action: { tool: 'exec_command', input: 'ls' },
            thinking: 'complete thinking',
        })

        const step = state.turns[0]?.steps[0]
        assert.strictEqual(step?.thinking, 'complete thinking')
        assert.strictEqual(step?.streamingThinking, undefined)
    })

    test('keeps structured parallel tool results associated by call id', () => {
        let state = createInitialTimelineState()

        state = chatTimelineReducer(state, { type: 'turn_start', turn: 1, input: 'inspect' })
        state = chatTimelineReducer(state, {
            type: 'tool_action',
            turn: 1,
            step: 0,
            action: { toolCallId: 'call-list', tool: 'list_directory', input: { path: '.' } },
            parallelActions: [
                { toolCallId: 'call-list', tool: 'list_directory', input: { path: '.' } },
                { toolCallId: 'call-search', tool: 'search_files', input: { path: '.', pattern: '*.md' } },
            ],
        })
        state = chatTimelineReducer(state, {
            type: 'tool_observation',
            turn: 1,
            step: 0,
            observation: 'combined legacy value',
            toolStatus: 'success',
            toolResults: [
                {
                    toolCallId: 'call-list',
                    tool: 'list_directory',
                    observation: '[DIR] packages',
                    status: 'success',
                },
                {
                    toolCallId: 'call-search',
                    tool: 'search_files',
                    observation: 'README.md',
                    status: 'success',
                },
            ],
        })

        assert.deepStrictEqual(
            state.turns[0]?.steps[0]?.toolResults?.map((result) => result.toolCallId),
            ['call-list', 'call-search'],
        )
    })

    test('turn_final promotes the live stream when no complete thinking is provided', () => {
        let state = createInitialTimelineState()

        state = chatTimelineReducer(state, { type: 'turn_start', turn: 1, input: 'hi' })
        state = chatTimelineReducer(state, { type: 'reasoning_chunk', turn: 1, step: 0, chunk: 'live trace' })
        state = chatTimelineReducer(state, {
            type: 'turn_final',
            turn: 1,
            finalText: 'done',
            status: 'ok',
            turnUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as LanguageModelUsage,
        })

        const step = state.turns[0]?.steps[0]
        assert.strictEqual(step?.thinking, 'live trace')
        assert.strictEqual(step?.streamingThinking, undefined)
    })
})
