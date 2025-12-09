import assert from 'node:assert'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, test, beforeAll, afterAll } from 'bun:test'
import { $ } from 'bun'
import { readTool } from '@memo/tools/tools/read'
import { writeTool } from '@memo/tools/tools/write'
import { editTool } from '@memo/tools/tools/edit'

let tempDir: string

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
    tempDir = await makeTempDir('memo-tools')
})

afterAll(async () => {
    await removeDir(tempDir)
})

describe('write tool', () => {
    test('rejects missing path', async () => {
        const res = writeTool.inputSchema.safeParse({ content: 'x' })
        assert.strictEqual(res.success, false)
    })

    test('writes content to file', async () => {
        const target = join(tempDir, 'write.txt')
        const res = await writeTool.execute({ file_path: target, content: 'hello' })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('已写入'), 'should acknowledge write')
        const content = await readText(target)
        assert.strictEqual(content, 'hello')
    })

    test('creates parent directories and stringifies JSON content', async () => {
        const target = join(tempDir, 'nested', 'write.json')
        const res = await writeTool.execute({ file_path: target, content: { foo: 'bar' } })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('nested/write.json'), 'should report target path')
        const content = await readText(target)
        assert.ok(content.includes('"foo": "bar"'), 'should write JSON stringified content')
    })
})

describe('read tool', () => {
    test('schema rejects invalid params', () => {
        const parsed = readTool.inputSchema.safeParse({})
        assert.strictEqual(parsed.success, false)
    })

    test('reads with offset and limit', async () => {
        const target = join(tempDir, 'read.txt')
        await writeTool.execute({ file_path: target, content: 'a\nb\nc\nd' })
        const res = await readTool.execute({ file_path: target, offset: 2, limit: 2 })
        const text = res.content?.find((item) => item.type === 'text')?.text ?? ''
        assert.strictEqual(text, '2: b\n3: c')
    })
})

describe('edit tool', () => {
    test('rejects missing fields', async () => {
        const res = editTool.inputSchema.safeParse({})
        assert.strictEqual(res.success, false)
    })

    test('replaces first occurrence by default', async () => {
        const target = join(tempDir, 'edit.txt')
        await writeTool.execute({ file_path: target, content: 'foo bar foo' })
        const res = await editTool.execute({
            file_path: target,
            old_string: 'foo',
            new_string: 'baz',
            replace_all: false,
        })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('count=1'))
        const content = await readText(target)
        assert.strictEqual(content, 'baz bar foo')
    })

    test('replaces all when replace_all is true', async () => {
        const target = join(tempDir, 'edit-all.txt')
        await writeTool.execute({ file_path: target, content: 'x y x y' })
        const res = await editTool.execute({
            file_path: target,
            old_string: 'y',
            new_string: 'z',
            replace_all: true,
        })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('count=2'))
        const content = await readText(target)
        assert.strictEqual(content, 'x z x z')
    })
})
