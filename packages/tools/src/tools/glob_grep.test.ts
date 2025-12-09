import assert from 'node:assert'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, test, beforeAll, afterAll } from 'bun:test'
import { $ } from 'bun'
import { globTool } from '@memo/tools/tools/glob'
import { grepTool } from '@memo/tools/tools/grep'

let tempDir: string
let filePath: string

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`)
    await $`mkdir -p ${dir}`
    return dir
}

async function removeDir(dir: string) {
    await $`rm -rf ${dir}`
}

beforeAll(async () => {
    tempDir = await makeTempDir('memo-tools-glob-grep')
    filePath = join(tempDir, 'sample.txt')
    await Bun.write(filePath, 'hello\nfoo bar\nbaz')
})

afterAll(async () => {
    await removeDir(tempDir)
})

describe('glob tool', () => {
    test('matches files under given path', async () => {
        const res = await globTool.execute({ pattern: '**/*.txt', path: tempDir })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('sample.txt'), 'should list matching file')
    })

    test('returns hint when no matches', async () => {
        const res = await globTool.execute({ pattern: '*.md', path: tempDir })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.strictEqual(text, '未找到匹配文件')
    })
})

describe('grep tool', () => {
    const rgAvailable = Boolean(Bun.which('rg'))

    test('finds content with default output', async () => {
        const res = await grepTool.execute({ pattern: 'foo', path: tempDir })
        if (!rgAvailable) {
            const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
            assert.strictEqual(text, 'rg 未安装或不在 PATH')
            return
        }
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('sample.txt'), 'should include filename')
        assert.ok(text.includes('foo bar'), 'should include matching line')
    })

    test('supports count output mode', async () => {
        const res = await grepTool.execute({
            pattern: 'hello',
            path: tempDir,
            output_mode: 'count',
        })
        if (!rgAvailable) {
            const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
            assert.strictEqual(text, 'rg 未安装或不在 PATH')
            return
        }
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        const trimmed = text.trim()
        assert.ok(trimmed.endsWith(':1') || /^\d+$/.test(trimmed))
    })

    test('returns hint when no matches', async () => {
        const res = await grepTool.execute({ pattern: 'notfound', path: tempDir })
        if (!rgAvailable) {
            const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
            assert.strictEqual(text, 'rg 未安装或不在 PATH')
            return
        }
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.strictEqual(text, '未找到匹配')
    })
})
