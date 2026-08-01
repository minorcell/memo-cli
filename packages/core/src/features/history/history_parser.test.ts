import assert from 'node:assert'
import { describe, test } from 'vitest'
import { parseHistoryLogToSessionDetail } from './history_parser'

function buildSampleLog(): string {
    return [
        JSON.stringify({
            ts: '2026-02-15T10:00:00.000Z',
            sessionId: 's1',
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

    test('restores session ui state from session_start meta', () => {
        const detail = parseHistoryLogToSessionDetail(buildSampleLog(), '/tmp/demo/s1.jsonl')
        assert.strictEqual(detail.providerName, 'deepseek')
        assert.strictEqual(detail.modelName, 'deepseek-chat')
        assert.strictEqual(detail.contextWindow, 64000)
        assert.strictEqual(detail.toolPermissionMode, 'once')
        assert.strictEqual(detail.thinking, true)
    })

    test('restores the latest thinking mode recorded by a turn', () => {
        const log = [
            buildSampleLog(),
            JSON.stringify({
                ts: '2026-02-15T10:00:06.000Z',
                sessionId: 's1',
                turn: 2,
                type: 'turn_start',
                content: 'continue',
                meta: { thinking: false },
            }),
        ].join('\n')

        const detail = parseHistoryLogToSessionDetail(log, '/tmp/demo/s1.jsonl')
        assert.strictEqual(detail.thinking, false)
    })

    test('ignores invalid optional ui state from older or damaged logs', () => {
        const log = JSON.stringify({
            ts: '2026-02-15T10:00:00.000Z',
            sessionId: 'legacy',
            type: 'session_start',
            meta: { cwd: '/tmp/demo', contextWindow: -1, thinking: 'yes' },
        })

        const detail = parseHistoryLogToSessionDetail(log, '/tmp/demo/legacy.jsonl')
        assert.strictEqual(detail.providerName, undefined)
        assert.strictEqual(detail.contextWindow, undefined)
        assert.strictEqual(detail.thinking, undefined)
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

    test('exposes the latest successful context_compact summary', () => {
        const log = [
            JSON.stringify({
                ts: '2026-02-15T10:00:00.000Z',
                sessionId: 's3',
                type: 'session_start',
                meta: { cwd: '/tmp/demo' },
            }),
            JSON.stringify({
                ts: '2026-02-15T10:00:02.000Z',
                sessionId: 's3',
                type: 'context_compact',
                content: '',
                meta: { status: 'failed' },
            }),
            JSON.stringify({
                ts: '2026-02-15T10:00:03.000Z',
                sessionId: 's3',
                type: 'context_compact',
                content: 'first summary',
                meta: { status: 'success', beforeTokens: 100, afterTokens: 20 },
            }),
            JSON.stringify({
                ts: '2026-02-15T10:00:04.000Z',
                sessionId: 's3',
                type: 'context_compact',
                content: 'latest summary',
                meta: { status: 'success', beforeTokens: 80, afterTokens: 15 },
            }),
        ].join('\n')

        const detail = parseHistoryLogToSessionDetail(log, '/tmp/demo/s3.jsonl')
        assert.strictEqual(detail.compactionSummary, 'latest summary')
    })

    test('leaves compactionSummary undefined when only failed compactions exist', () => {
        const log = [
            JSON.stringify({
                ts: '2026-02-15T10:00:00.000Z',
                sessionId: 's4',
                type: 'session_start',
                meta: { cwd: '/tmp/demo' },
            }),
            JSON.stringify({
                ts: '2026-02-15T10:00:02.000Z',
                sessionId: 's4',
                type: 'context_compact',
                content: '',
                meta: { status: 'failed' },
            }),
        ].join('\n')

        const detail = parseHistoryLogToSessionDetail(log, '/tmp/demo/s4.jsonl')
        assert.strictEqual(detail.compactionSummary, undefined)
    })
})
