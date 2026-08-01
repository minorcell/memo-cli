import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { unlink, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonlHistorySink } from '@memo/core/features/history'
import { createHistoryEvent } from '@memo/core/agent/loop'

const getTempFilePath = () => join(tmpdir(), `memo-test-${Date.now()}.jsonl`)

describe('JsonlHistorySink', () => {
    let filePath: string

    beforeEach(() => {
        filePath = getTempFilePath()
    })

    afterEach(async () => {
        if (existsSync(filePath)) {
            await unlink(filePath)
        }
    })

    test('appends event as JSONL line', async () => {
        const sink = new JsonlHistorySink(filePath)
        const event = createHistoryEvent({
            sessionId: 'test-session',
            type: 'session_start',
        })

        await sink.append(event)

        const content = await readFile(filePath, 'utf8')
        const lines = content.trim().split('\n')
        expect(lines).toHaveLength(1)
        const firstLine = lines[0]
        if (!firstLine) throw new Error('Expected line to exist')
        const parsed = JSON.parse(firstLine) as unknown as { sessionId: string; type: string }
        expect(parsed.sessionId === 'test-session').toBe(true)
        expect(parsed.type === 'session_start').toBe(true)
    })

    test('creates parent directory if not exists', async () => {
        const nestedPath = join(tmpdir(), `memo-test-nested-${Date.now()}`, 'subdir', 'test.jsonl')
        const sink = new JsonlHistorySink(nestedPath)
        const event = createHistoryEvent({
            sessionId: 'test-session',
            type: 'turn_start',
        })

        await sink.append(event)

        expect(existsSync(nestedPath)).toBe(true)
    })

    test('appends multiple events sequentially', async () => {
        const sink = new JsonlHistorySink(filePath)
        const events = [
            createHistoryEvent({ sessionId: 's1', type: 'session_start' }),
            createHistoryEvent({ sessionId: 's1', type: 'turn_start', turn: 1 }),
            createHistoryEvent({ sessionId: 's1', type: 'final', turn: 1, step: 1 }),
        ]

        for (const event of events) {
            await sink.append(event)
        }

        const content = await readFile(filePath, 'utf8')
        const lines = content.trim().split('\n')
        expect(lines).toHaveLength(3)

        const parsed = lines.map((l) => JSON.parse(l) as unknown as { type?: string })
        expect(parsed[0]?.type === 'session_start').toBe(true)
        expect(parsed[1]?.type === 'turn_start').toBe(true)
        expect(parsed[2]?.type === 'final').toBe(true)
    })

    test('writes context usage and context compact event types', async () => {
        const sink = new JsonlHistorySink(filePath)
        const events = [
            createHistoryEvent({
                sessionId: 's-context',
                type: 'context_usage',
                turn: 1,
                step: 0,
                meta: { phase: 'step_start', prompt_tokens: 123 },
            }),
            createHistoryEvent({
                sessionId: 's-context',
                type: 'context_compact',
                turn: 1,
                step: 0,
                meta: { reason: 'auto', status: 'success', before_tokens: 123, after_tokens: 80 },
            }),
        ]

        for (const event of events) {
            await sink.append(event)
        }
        await sink.flush()

        const lines = (await readFile(filePath, 'utf8')).trim().split('\n').filter(Boolean)
        expect(lines).toHaveLength(2)
        const parsed = lines.map((line) => JSON.parse(line) as { type?: string })
        expect(parsed[0]?.type).toBe('context_usage')
        expect(parsed[1]?.type).toBe('context_compact')
    })

    test('flush returns resolved promise', async () => {
        const sink = new JsonlHistorySink(filePath)
        await expect(sink.flush()).resolves.toBeUndefined()
    })

    test('serializes concurrent append calls without losing lines', async () => {
        const sink = new JsonlHistorySink(filePath)
        const events = Array.from({ length: 20 }, (_, idx) =>
            createHistoryEvent({
                sessionId: 'concurrent',
                type: 'action',
                step: idx,
                content: `event-${idx}`,
            }),
        )

        await Promise.all(events.map((event) => sink.append(event)))
        await sink.flush()

        const lines = (await readFile(filePath, 'utf8')).trim().split('\n').filter(Boolean)
        expect(lines).toHaveLength(20)
        const parsed = lines.map((line) => JSON.parse(line) as { content?: string })
        expect(parsed[0]?.content).toBe('event-0')
        expect(parsed[19]?.content).toBe('event-19')
    })

    test('close flushes pending writes and rejects future appends', async () => {
        const sink = new JsonlHistorySink(filePath)
        const first = sink.append(createHistoryEvent({ sessionId: 's-close', type: 'turn_start' }))
        const second = sink.append(createHistoryEvent({ sessionId: 's-close', type: 'assistant', content: 'done' }))
        await sink.close()
        await Promise.all([first, second])

        const lines = (await readFile(filePath, 'utf8')).trim().split('\n').filter(Boolean)
        expect(lines).toHaveLength(2)
        await expect(sink.append(createHistoryEvent({ sessionId: 's-close', type: 'final' }))).rejects.toThrow(
            'History sink is closed',
        )
    })

    test('handles special characters in content', async () => {
        const sink = new JsonlHistorySink(filePath)
        const event = createHistoryEvent({
            sessionId: 'test-session',
            type: 'assistant',
            content: 'Line 1\nLine 2\tTabbed"Quotes"',
        })

        await sink.append(event)

        const content = await readFile(filePath, 'utf8')
        const trimmed = content.trim()
        if (!trimmed) throw new Error('Expected content to exist')
        const parsed = JSON.parse(trimmed) as unknown as { content: string }
        expect(parsed.content === 'Line 1\nLine 2\tTabbed"Quotes"').toBe(true)
    })
})

describe('createHistoryEvent', () => {
    test('creates minimal event', () => {
        const event = createHistoryEvent({
            sessionId: 'session-1',
            type: 'session_start',
        })

        expect(event).toMatchObject({
            sessionId: 'session-1',
            type: 'session_start',
            ts: expect.any(String),
        })
        expect(event.turn).toBeUndefined()
        expect(event.step).toBeUndefined()
        expect(event.content).toBeUndefined()
        expect(event.role).toBeUndefined()
        expect(event.meta).toBeUndefined()
    })

    test('creates event with all optional fields', () => {
        const meta = { tool: 'read_file', tokens: 42 }
        const event = createHistoryEvent({
            sessionId: 'session-2',
            type: 'action',
            turn: 1,
            step: 2,
            content: 'Running command',
            role: 'assistant',
            meta,
        })

        expect(event).toMatchObject({
            sessionId: 'session-2',
            type: 'action',
            turn: 1,
            step: 2,
            content: 'Running command',
            role: 'assistant',
            meta,
        })
        expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    test('generates ISO format timestamps', () => {
        const event = createHistoryEvent({
            sessionId: 's1',
            type: 'session_start',
        })

        expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
})
