import assert from 'node:assert'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterAll, describe, test } from 'bun:test'
import { buildSessionPath } from '@memo/core/config/config'

let originalCwd: string
let tempBase: string

beforeAll(async () => {
    originalCwd = process.cwd()
    tempBase = join(tmpdir(), 'memo-core-config-test')
    await mkdir(tempBase, { recursive: true })
})

afterAll(async () => {
    process.chdir(originalCwd)
})

describe('buildSessionPath', () => {
    test('embeds sanitized cwd into history path with timestamped filename', async () => {
        const projectDir = join(tempBase, 'My Project:Demo with spaces')
        await mkdir(projectDir, { recursive: true })
        process.chdir(projectDir)

        const path = buildSessionPath('/history-base', 'session123')
        const filename = path.split(/[/\\]/).pop()!
        const dirName = path.split(/[/\\]/).slice(-2, -1)[0]!

        assert.ok(path.startsWith('/history-base'), 'should prefix base dir')
        assert.ok(
            /\d{4}-\d{2}-\d{2}_\d{6}_session123\.jsonl$/.test(filename),
            'filename should contain date/time and session id',
        )
        assert.ok(
            dirName.includes('My-Project-Demo-with-spaces'),
            'cwd part should be sanitized with separators',
        )
    })

    test('truncates overly long path parts to avoid excessive length', async () => {
        const longSegment = 'x'.repeat(150)
        const longDir = join(tempBase, longSegment)
        await mkdir(longDir, { recursive: true })
        const prev = process.cwd()
        process.chdir(longDir)

        const path = buildSessionPath('/history-base', 's')
        const dirName = path.split(/[/\\]/).slice(-2, -1)[0]!
        const segments = dirName.split('-')

        process.chdir(prev)
        assert.ok(dirName.length <= 180, 'directory part should be truncated to max length')
        assert.ok(
            segments.every((p) => p.length > 0 && p.length <= 100),
            'each segment should respect per-part limit',
        )
    })
})
