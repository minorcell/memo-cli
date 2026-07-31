import assert from 'node:assert'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'vitest'
import { loadSessionHistoryEntries } from './sessionHistory'

function buildHistoryLine(event: Record<string, unknown>): string {
    return JSON.stringify({
        ts: new Date().toISOString(),
        sessionId: 'session-1',
        ...event,
    })
}

async function writeSessionFile(sessionsDir: string, fileName: string, lines: string[]): Promise<string> {
    await mkdir(sessionsDir, { recursive: true })
    const filePath = join(sessionsDir, fileName)
    await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8')
    return filePath
}

describe('loadSessionHistoryEntries', () => {
    test('prefers session_title over first prompt for history display', async () => {
        const sessionsDir = join(tmpdir(), `memo-session-history-${Date.now()}-title`)
        const cwd = join(tmpdir(), `memo-session-cwd-${Date.now()}`)
        await mkdir(cwd, { recursive: true })

        try {
            await writeSessionFile(sessionsDir, 'rollout-title.jsonl', [
                buildHistoryLine({ type: 'session_start', meta: { cwd } }),
                buildHistoryLine({ type: 'turn_start', content: 'Help me create an API' }),
                buildHistoryLine({ type: 'session_title', content: 'Express.js REST API' }),
            ])

            const entries = await loadSessionHistoryEntries({ sessionsDir, cwd })
            assert.strictEqual(entries.length, 1)
            assert.strictEqual(entries[0]?.input, 'Express.js REST API')
        } finally {
            await rm(sessionsDir, { recursive: true, force: true })
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test('falls back to first prompt when session_title is missing', async () => {
        const sessionsDir = join(tmpdir(), `memo-session-history-${Date.now()}-prompt`)
        const cwd = join(tmpdir(), `memo-session-cwd-${Date.now()}`)
        await mkdir(cwd, { recursive: true })

        try {
            await writeSessionFile(sessionsDir, 'rollout-prompt.jsonl', [
                buildHistoryLine({ type: 'session_start', meta: { cwd } }),
                buildHistoryLine({ type: 'turn_start', content: 'Design a postgres schema' }),
            ])

            const entries = await loadSessionHistoryEntries({ sessionsDir, cwd })
            assert.strictEqual(entries.length, 1)
            assert.strictEqual(entries[0]?.input, 'Design a postgres schema')
        } finally {
            await rm(sessionsDir, { recursive: true, force: true })
            await rm(cwd, { recursive: true, force: true })
        }
    })
})
