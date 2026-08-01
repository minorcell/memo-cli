import assert from 'node:assert'
import { describe, test } from 'vitest'
import { CONTEXT_SUMMARY_PREFIX } from '@memo/core'
import { TOOL_STATUS } from '../../shared/types'
import { parseHistoryLog } from './historyParser'

function line(event: Record<string, unknown>): string {
    return JSON.stringify({
        ts: new Date().toISOString(),
        sessionId: 'session-1',
        ...event,
    })
}

describe('parseHistoryLog', () => {
    test('maps core history detail to tui timeline model', () => {
        const raw = [
            line({
                type: 'session_start',
                meta: {
                    cwd: '/tmp/demo',
                    providerName: 'deepseek',
                    modelName: 'deepseek-chat',
                    contextWindow: 64000,
                    toolPermissionMode: 'once',
                    thinking: true,
                },
            }),
            line({ type: 'turn_start', turn: 1, content: 'plan this task' }),
            line({ type: 'assistant', turn: 1, step: 0, content: 'thinking...' }),
            line({
                type: 'action',
                turn: 1,
                step: 0,
                meta: {
                    tool: 'read_file',
                    input: { path: 'README.md' },
                    thinking: 'need context',
                },
            }),
            line({
                type: 'observation',
                turn: 1,
                step: 0,
                content: 'loaded',
                meta: { tool: 'read_file', action_id: 'call-read', status: 'success' },
            }),
            line({
                type: 'final',
                turn: 1,
                content: 'done',
                meta: { status: 'ok' },
            }),
        ].join('\n')

        const parsed = parseHistoryLog(raw)
        assert.strictEqual(parsed.providerName, 'deepseek')
        assert.strictEqual(parsed.modelName, 'deepseek-chat')
        assert.strictEqual(parsed.contextWindow, 64000)
        assert.strictEqual(parsed.toolPermissionMode, 'once')
        assert.strictEqual(parsed.thinking, true)
        assert.strictEqual(parsed.messages.length, 2)
        assert.strictEqual(parsed.messages[0]?.role, 'user')
        assert.strictEqual(parsed.messages[0]?.content, 'plan this task')
        assert.strictEqual(parsed.messages[1]?.role, 'assistant')
        assert.strictEqual(parsed.messages[1]?.content, 'done')

        assert.strictEqual(parsed.turns.length, 1)
        const turn = parsed.turns[0]
        assert.ok(turn)
        assert.strictEqual(turn?.userInput, 'plan this task')
        assert.strictEqual(turn?.finalText, 'done')
        assert.strictEqual(turn?.status, 'ok')
        assert.strictEqual(turn?.steps.length, 1)
        assert.strictEqual(turn?.steps[0]?.action?.tool, 'read_file')
        assert.strictEqual(turn?.steps[0]?.thinking, 'need context')
        assert.strictEqual(turn?.steps[0]?.observation, 'loaded')
        assert.strictEqual(turn?.steps[0]?.toolStatus, TOOL_STATUS.SUCCESS)
        assert.deepStrictEqual(turn?.steps[0]?.toolResults, [
            {
                toolCallId: 'call-read',
                tool: 'read_file',
                observation: 'loaded',
                status: TOOL_STATUS.SUCCESS,
            },
        ])
    })

    test('injects the latest compaction summary as the first message', () => {
        const raw = [
            line({ type: 'session_start', meta: { cwd: '/tmp/demo' } }),
            line({ type: 'turn_start', turn: 1, content: 'question one' }),
            line({ type: 'final', turn: 1, content: 'answer one', meta: { status: 'ok' } }),
            line({
                type: 'context_compact',
                content: 'latest summary body',
                meta: { status: 'success', beforeTokens: 100, afterTokens: 20 },
            }),
            line({ type: 'turn_start', turn: 2, content: 'question two' }),
            line({ type: 'final', turn: 2, content: 'answer two', meta: { status: 'ok' } }),
        ].join('\n')

        const parsed = parseHistoryLog(raw)
        assert.strictEqual(parsed.compactionSummary, 'latest summary body')
        const first = parsed.messages[0]
        assert.strictEqual(first?.role, 'user')
        assert.ok(typeof first?.content === 'string' && first.content.startsWith(`${CONTEXT_SUMMARY_PREFIX}\n`))
        assert.ok(typeof first?.content === 'string' && first.content.endsWith('latest summary body'))
        // The turn pairs still follow, in order.
        assert.deepStrictEqual(
            parsed.messages.slice(1).map((message) => message.content),
            ['question one', 'answer one', 'question two', 'answer two'],
        )
    })
})
