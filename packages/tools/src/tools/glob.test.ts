import assert from 'node:assert'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, test, beforeAll, afterAll } from 'bun:test'
import { $ } from 'bun'
import { globTool } from '@memo/tools/tools/glob'

let tempDir: string

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`)
    await $`mkdir -p ${dir}`
    return dir
}

async function removeDir(dir: string) {
    await $`rm -rf ${dir}`
}

beforeAll(async () => {
    tempDir = await makeTempDir('memo-tools-glob')
    await Bun.write(join(tempDir, 'a.ts'), 'content')
    await Bun.write(join(tempDir, 'b.js'), 'content')
})

afterAll(async () => {
    await removeDir(tempDir)
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
