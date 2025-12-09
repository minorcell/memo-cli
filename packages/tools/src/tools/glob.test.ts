import assert from 'node:assert'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, test, beforeAll, afterAll } from 'bun:test'
import { globTool } from '@memo/tools/tools/glob'

let tempDir: string

beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'memo-tools-glob-'))
    await writeFile(join(tempDir, 'a.ts'), 'content')
    await writeFile(join(tempDir, 'b.js'), 'content')
})

afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
})

describe('glob tool', () => {
    test('validates input', async () => {
        const res = globTool.inputSchema.safeParse({})
        assert.strictEqual(res.success, false)
    })

    test('matches pattern under provided path', async () => {
        const res = await globTool.execute({ pattern: '**/*.ts', path: tempDir })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        const files = text
            .split('\n')
            .filter(Boolean)
            .map((p) => basename(p))
        assert.deepStrictEqual(files.sort(), ['a.ts'])
    })
})
