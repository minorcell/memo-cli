import assert from 'node:assert'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, test } from 'vitest'
import { aggregateToolUsage, HistoryIndex } from './history_index'

function logFor(sessionId: string, cwd: string, startedAt: string, extras: string[] = []): string {
    const day = startedAt.slice(0, 10)
    return [
        JSON.stringify({
            ts: startedAt,
            sessionId,
            type: 'session_start',
            meta: { cwd },
        }),
        JSON.stringify({
            ts: `${day}T10:00:01.000Z`,
            sessionId,
            turn: 1,
            type: 'turn_start',
            content: `hello ${sessionId}`,
        }),
        ...extras,
        JSON.stringify({
            ts: `${day}T10:00:09.000Z`,
            sessionId,
            turn: 1,
            type: 'final',
            content: 'done',
            meta: {
                status: 'ok',
                tokens: { prompt: 3, completion: 2, total: 5 },
            },
        }),
    ].join('\n')
}

describe('HistoryIndex', () => {
    test('lists sessions, paginates, and returns detail/events', async () => {
        const root = await mkdtemp(join(tmpdir(), 'memo-history-index-basic-'))
        const sessionsDir = join(root, 'sessions')
        await mkdir(sessionsDir, { recursive: true })

        await writeFile(
            join(sessionsDir, '2026-02-15-a.jsonl'),
            logFor('a', '/tmp/workspace-a/project-a', '2026-02-15T10:00:00.000Z'),
            'utf8',
        )
        await writeFile(
            join(sessionsDir, '2026-02-14-b.jsonl'),
            logFor('b', '/tmp/workspace-b/project-b', '2026-02-14T10:00:00.000Z'),
            'utf8',
        )

        const index = new HistoryIndex({ sessionsDir })
        const list = await index.list({ page: 1, pageSize: 1 })
        assert.strictEqual(list.total, 2)
        assert.strictEqual(list.items.length, 1)
        assert.strictEqual(list.totalPages, 2)

        const detail = await index.getSessionDetail('a')
        assert.ok(detail)
        assert.strictEqual(detail?.sessionId, 'a')

        const events = await index.getSessionEvents('a', '0', 2)
        assert.ok(events)
        assert.strictEqual(events?.items.length, 2)
        assert.strictEqual(events?.nextCursor, '2')

        await rm(root, { recursive: true, force: true })
    })

    test('supports filter/sort options and excludes fallback project names', async () => {
        const root = await mkdtemp(join(tmpdir(), 'memo-history-index-filter-'))
        const sessionsDir = join(root, 'sessions')
        await mkdir(sessionsDir, { recursive: true })

        await writeFile(
            join(sessionsDir, 'a.jsonl'),
            logFor('s1', '/tmp/ws-a/project-alpha', '2026-02-16T10:00:00.000Z'),
            'utf8',
        )
        await writeFile(
            join(sessionsDir, 'b.jsonl'),
            logFor('s2', '/tmp/ws-b/project-beta', '2026-02-14T10:00:00.000Z'),
            'utf8',
        )
        await writeFile(
            join(sessionsDir, 'fallback-id.jsonl'),
            logFor('fallback-id', '/tmp/ws-a/123e4567-e89b-12d3-a456-426614174000', '2026-02-15T10:00:00.000Z'),
            'utf8',
        )

        const index = new HistoryIndex({ sessionsDir })

        const all = await index.list({ sortBy: 'project', order: 'asc' })
        assert.strictEqual(all.total, 2)
        assert.deepStrictEqual(
            all.items.map((item) => item.project),
            ['project-alpha', 'project-beta'],
        )

        const workspaceFiltered = await index.list({ workspaceCwd: '/tmp/ws-a' })
        assert.strictEqual(workspaceFiltered.total, 1)
        assert.strictEqual(workspaceFiltered.items[0]?.project, 'project-alpha')

        const projectFiltered = await index.list({ project: 'project-beta' })
        assert.strictEqual(projectFiltered.total, 1)
        assert.strictEqual(projectFiltered.items[0]?.sessionId, 'b')

        const dateFiltered = await index.list({
            dateFrom: '2026-02-15',
            dateTo: '2026-02-16',
            q: 'alpha',
            sortBy: 'startedAt',
            order: 'desc',
        })
        assert.strictEqual(dateFiltered.total, 1)
        assert.strictEqual(dateFiltered.items[0]?.project, 'project-alpha')

        await rm(root, { recursive: true, force: true })
    })

    test('refresh handles malformed files and removed files resiliently', async () => {
        const root = await mkdtemp(join(tmpdir(), 'memo-history-index-refresh-'))
        const sessionsDir = join(root, 'sessions')
        await mkdir(sessionsDir, { recursive: true })

        const validPath = join(sessionsDir, 'valid.jsonl')
        const badPath = join(sessionsDir, 'bad.jsonl')
        await writeFile(validPath, logFor('ok', '/tmp/ws-ok/project-ok', '2026-02-15T10:00:00.000Z'), 'utf8')
        await writeFile(badPath, '{"invalid":', 'utf8')

        const index = new HistoryIndex({ sessionsDir })
        const first = await index.list({})
        assert.strictEqual(first.total, 1)

        await rm(validPath, { force: true })
        const second = await index.list({})
        assert.strictEqual(second.total, 0)
        assert.strictEqual(await index.getSessionDetail('ok'), null)

        await rm(root, { recursive: true, force: true })
    })

    test('events API normalizes cursor/limit and aggregateToolUsage summarises statuses', async () => {
        const root = await mkdtemp(join(tmpdir(), 'memo-history-index-events-'))
        const sessionsDir = join(root, 'sessions')
        await mkdir(sessionsDir, { recursive: true })

        const day = '2026-02-15'
        const extras = [
            JSON.stringify({
                ts: `${day}T10:00:02.000Z`,
                sessionId: 'evt',
                turn: 1,
                step: 0,
                type: 'action',
                meta: { tool: 'read_file' },
            }),
            JSON.stringify({
                ts: `${day}T10:00:03.000Z`,
                sessionId: 'evt',
                turn: 1,
                step: 0,
                type: 'action',
                meta: { tools: ['grep_files', 'read_file'] },
            }),
            JSON.stringify({
                ts: `${day}T10:00:04.000Z`,
                sessionId: 'evt',
                turn: 1,
                step: 0,
                type: 'observation',
                meta: { tool: 'read_file', status: 'success' },
            }),
            JSON.stringify({
                ts: `${day}T10:00:05.000Z`,
                sessionId: 'evt',
                turn: 1,
                step: 1,
                type: 'observation',
                meta: { tool: 'grep_files', status: 'approval_denied' },
            }),
            JSON.stringify({
                ts: `${day}T10:00:06.000Z`,
                sessionId: 'evt',
                turn: 1,
                step: 2,
                type: 'observation',
                meta: { tool: 'grep_files', status: 'cancelled' },
            }),
            JSON.stringify({
                ts: `${day}T10:00:07.000Z`,
                sessionId: 'evt',
                turn: 1,
                step: 3,
                type: 'observation',
                meta: { tool: 'grep_files', status: 'other' },
            }),
        ]

        await writeFile(
            join(sessionsDir, 'events.jsonl'),
            logFor('evt', '/tmp/ws-events/project-events', `${day}T10:00:00.000Z`, extras),
            'utf8',
        )

        const index = new HistoryIndex({ sessionsDir })
        const allEvents = await index.getSessionEvents('events', 'not-a-number', 0)
        assert.ok(allEvents)
        assert.ok((allEvents?.items.length ?? 0) > 4)

        const paged = await index.getSessionEvents('events', '2', 1)
        assert.strictEqual(paged?.items.length, 1)
        assert.strictEqual(paged?.nextCursor, '3')

        const detail = await index.getSessionDetail('events')
        assert.ok(detail)
        const usage = aggregateToolUsage(detail?.events ?? [])
        assert.deepStrictEqual(usage.read_file, {
            total: 1,
            success: 1,
            failed: 0,
            denied: 0,
            cancelled: 0,
        })
        assert.deepStrictEqual(usage.grep_files, {
            total: 1,
            success: 0,
            failed: 2,
            denied: 1,
            cancelled: 1,
        })

        await rm(root, { recursive: true, force: true })
    })
})
