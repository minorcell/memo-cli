import assert from 'node:assert'
import { describe, test } from 'vitest'
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
            line({ type: 'session_start', meta: { cwd: '/tmp/demo' } }),
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
})
