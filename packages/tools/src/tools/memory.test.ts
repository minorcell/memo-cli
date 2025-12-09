import assert from 'node:assert'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, test, beforeAll, afterAll } from 'bun:test'
import { $ } from 'bun'
import { memoryTool } from '@memo/tools/tools/memory'

let tempHome: string
let prevMemoHome: string | undefined

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`)
    await $`mkdir -p ${dir}`
    return dir
}

async function removeDir(dir: string) {
    await $`rm -rf ${dir}`
}

async function readText(path: string) {
    const file = Bun.file(path)
    if (await file.exists()) {
        return file.text()
    }
    return ''
}

beforeAll(async () => {
    tempHome = await makeTempDir('memo-tools-memory')
    prevMemoHome = process.env.MEMO_HOME
    process.env.MEMO_HOME = tempHome
})

afterAll(async () => {
    if (prevMemoHome === undefined) {
        delete process.env.MEMO_HOME
    } else {
        process.env.MEMO_HOME = prevMemoHome
    }
    await removeDir(tempHome)
})

describe('memory tool', () => {
    test('rejects empty note', async () => {
        const parsed = memoryTool.inputSchema.safeParse({ note: '' })
        assert.strictEqual(parsed.success, false)
    })

    test('rejects too long note', async () => {
        const parsed = memoryTool.inputSchema.safeParse({ note: 'a'.repeat(40) })
        assert.strictEqual(parsed.success, false)
    })

    test('appends sanitized note to memory file', async () => {
        const res = await memoryTool.execute({ note: '  喜欢中文回答\n' })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('memory'), 'should report memory path')
        const memoryPath = join(tempHome, 'memory.md')
        const content = await readText(memoryPath)
        assert.ok(content.includes('喜欢中文回答'), 'memory file should contain note')
        assert.ok(!content.includes('\n\n'), 'note should be sanitized')
    })

    test('keeps only 50 most recent notes', async () => {
        const memoryPath = join(tempHome, 'memory.md')
        for (let i = 0; i < 55; i++) {
            await memoryTool.execute({ note: `n${i}` })
        }
        const content = await readText(memoryPath)
        const lines = content
            .split(/\r?\n/)
            .filter((l) => l.trim().startsWith('- '))
        assert.strictEqual(lines.length, 50, 'should retain at most 50 entries')
        assert.ok(lines.length > 0, 'should have entries')
        const first = lines[0]!
        const last = lines[lines.length - 1]!
        assert.ok(first.includes('n5'), 'should drop oldest entries')
        assert.ok(last.includes('n54'), 'should keep newest entry')
    })
})
