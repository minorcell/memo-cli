import assert from 'node:assert'
import { describe, test } from 'vitest'
import { parseHistoryLogToSessionDetail } from './history_parser'

function buildSampleLog(): string {
    return [
        JSON.stringify({
            ts: '2026-02-15T10:00:00.000Z',
            sessionId: 's1',
            type: 'session_start',
            meta: { cwd: '/tmp/demo' },
        }),
        JSON.stringify({
            ts: '2026-02-15T10:00:01.000Z',
            sessionId: 's1',
            turn: 1,
            type: 'turn_start',
            content: 'hello',
        }),
        JSON.stringify({
            ts: '2026-02-15T10:00:02.000Z',
            sessionId: 's1',
            turn: 1,
            step: 0,
            type: 'assistant',
            content: 'world',
        }),
        JSON.stringify({
            ts: '2026-02-15T10:00:03.000Z',
            sessionId: 's1',
            turn: 1,
            step: 0,
            type: 'action',
            meta: { tool: 'read_file', input: { path: 'a.txt' } },
        }),
        JSON.stringify({
            ts: '2026-02-15T10:00:04.000Z',
            sessionId: 's1',
            turn: 1,
            step: 0,
            type: 'observation',
            content: 'ok',
            meta: { tool: 'read_file', status: 'success' },
        }),
        JSON.stringify({
            ts: '2026-02-15T10:00:05.000Z',
            sessionId: 's1',
            turn: 1,
            type: 'final',
            content: 'done',
            meta: {
                status: 'ok',
                tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            },
        }),
    ].join('\n')
}

describe('parseHistoryLogToSessionDetail', () => {
    test('parses summary and turns', () => {
        const detail = parseHistoryLogToSessionDetail(buildSampleLog(), '/tmp/demo/s1.jsonl')
        assert.strictEqual(detail.sessionId, 's1')
        assert.strictEqual(detail.project, 'demo')
        assert.strictEqual(detail.turnCount, 1)
        assert.strictEqual(detail.toolUsage.total, 1)
        assert.strictEqual(detail.toolUsage.success, 1)
        assert.strictEqual(detail.tokenUsage.totalTokens, 15)
        assert.strictEqual(detail.turns.length, 1)
        assert.strictEqual(detail.turns[0]?.steps.length, 1)
        assert.ok(detail.summary.includes('User: hello'))
    })

    test('sanitizes think/thinking blocks from title', () => {
        const log = [
            JSON.stringify({
                ts: '2026-02-15T10:00:00.000Z',
                sessionId: 's2',
                type: 'session_start',
                meta: { cwd: '/tmp/demo' },
            }),
            JSON.stringify({
                ts: '2026-02-15T10:00:01.000Z',
                sessionId: 's2',
                type: 'session_title',
                content: '<think>internal chain of thought</think>  Build release plan <thinking>hidden</thinking>',
            }),
        ].join('\n')

        const detail = parseHistoryLogToSessionDetail(log, '/tmp/demo/s2.jsonl')
        assert.strictEqual(detail.title, 'Build release plan')
    })
})
