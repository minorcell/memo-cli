import assert from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, test } from 'vitest'
import {
    appendLongResultHint,
    getIgnoreMatcher,
    getWritableRoots,
    isWritePathAllowed,
    normalizePath,
    writePathDenyReason,
} from '@memo/tools/tools/helpers'

const tempDirs: string[] = []

async function makeTempDir(prefix: string) {
    const dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
    tempDirs.push(dir)
    return dir
}

afterEach(async () => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        await rm(dir, { recursive: true, force: true })
    }
})

describe('helpers.normalizePath', () => {
    test('normalizes relative paths to absolute', () => {
        const normalized = normalizePath('./tmp/../tmp/file.txt')
        assert.ok(normalized.endsWith('/tmp/file.txt') || normalized.endsWith('\\tmp\\file.txt'))
        assert.ok(normalized.startsWith('/'), 'should be absolute path')
    })
})

describe('helpers.sandbox', () => {
    test('allows write path under configured writable roots', () => {
        const prev = process.env.MEMO_SANDBOX_WRITABLE_ROOTS
        const root = join(tmpdir(), `memo-sandbox-${crypto.randomUUID()}`)
        process.env.MEMO_SANDBOX_WRITABLE_ROOTS = root
        try {
            const target = join(root, 'a.txt')
            assert.strictEqual(isWritePathAllowed(normalizePath(target)), true)
        } finally {
            if (prev === undefined) delete process.env.MEMO_SANDBOX_WRITABLE_ROOTS
            else process.env.MEMO_SANDBOX_WRITABLE_ROOTS = prev
        }
    })

    test('denies write path outside writable roots', () => {
        const prev = process.env.MEMO_SANDBOX_WRITABLE_ROOTS
        const root = join(tmpdir(), `memo-sandbox-${crypto.randomUUID()}`)
        process.env.MEMO_SANDBOX_WRITABLE_ROOTS = root
        try {
            const outside = normalizePath('/etc/passwd')
            assert.strictEqual(isWritePathAllowed(outside), false)
            const reason = writePathDenyReason(outside) ?? ''
            assert.ok(reason.includes('sandbox write denied'))
            assert.ok(reason.includes('is not within allowed directories'))
        } finally {
            if (prev === undefined) delete process.env.MEMO_SANDBOX_WRITABLE_ROOTS
            else process.env.MEMO_SANDBOX_WRITABLE_ROOTS = prev
        }
    })

    test('returns null deny reason for allowed paths', async () => {
        const prev = process.env.MEMO_SANDBOX_WRITABLE_ROOTS
        const root = await makeTempDir('memo-sandbox-allowed')
        process.env.MEMO_SANDBOX_WRITABLE_ROOTS = root
        try {
            const target = join(root, 'inside.txt')
            await writeFile(target, 'ok', 'utf8')
            assert.strictEqual(writePathDenyReason(target), null)
        } finally {
            if (prev === undefined) delete process.env.MEMO_SANDBOX_WRITABLE_ROOTS
            else process.env.MEMO_SANDBOX_WRITABLE_ROOTS = prev
        }
    })

    test('parses writable roots from env and removes duplicates', async () => {
        const prevHome = process.env.MEMO_HOME
        const prevWritable = process.env.MEMO_SANDBOX_WRITABLE_ROOTS
        const memoHome = await makeTempDir('memo-home')
        const extra = await makeTempDir('memo-extra-root')
        process.env.MEMO_HOME = memoHome
        process.env.MEMO_SANDBOX_WRITABLE_ROOTS = ` ${memoHome}, ${extra}, ${extra}/ ,`

        try {
            await writeFile(join(memoHome, 'home.txt'), 'home', 'utf8')
            await writeFile(join(extra, 'extra.txt'), 'extra', 'utf8')
            const roots = getWritableRoots()
            assert.strictEqual(isWritePathAllowed(join(memoHome, 'home.txt')), true)
            assert.strictEqual(isWritePathAllowed(join(extra, 'extra.txt')), true)
            assert.strictEqual(new Set(roots).size, roots.length)
        } finally {
            if (prevHome === undefined) delete process.env.MEMO_HOME
            else process.env.MEMO_HOME = prevHome
            if (prevWritable === undefined) delete process.env.MEMO_SANDBOX_WRITABLE_ROOTS
            else process.env.MEMO_SANDBOX_WRITABLE_ROOTS = prevWritable
        }
    })
})

describe('helpers.ignore', () => {
    test('builds matcher from project root and applies ignore rules', async () => {
        const root = await makeTempDir('memo-ignore')
        await mkdir(join(root, '.git'))
        await mkdir(join(root, 'nested'))
        await writeFile(join(root, '.gitignore'), '# comment\n*.tmp\ncustom/\n', 'utf8')
        const startFile = join(root, 'nested', 'entry.ts')
        await writeFile(startFile, 'export {}', 'utf8')

        const matcher = await getIgnoreMatcher(startFile)
        assert.strictEqual(matcher.root, root)
        assert.strictEqual(matcher.ignores(join(root, 'node_modules', 'dep.js')), true)
        assert.strictEqual(matcher.ignores(join(root, 'foo.tmp')), true)
        assert.strictEqual(matcher.ignores(join(root, 'custom', 'a.txt')), true)
        assert.strictEqual(matcher.ignores(join(root, 'src', 'index.ts')), false)
        assert.strictEqual(matcher.ignores(join(tmpdir(), `outside-${crypto.randomUUID()}.ts`)), false)
    })

    test('reuses cached matcher for the same root', async () => {
        const root = await makeTempDir('memo-ignore-cache')
        await mkdir(join(root, '.git'))

        const first = await getIgnoreMatcher(root)
        const second = await getIgnoreMatcher(root)
        assert.strictEqual(first, second)
    })

    test('falls back to cwd when start path is invalid', async () => {
        const missing = join(tmpdir(), `missing-${crypto.randomUUID()}`)
        const matcher = await getIgnoreMatcher(missing)
        assert.strictEqual(matcher.root, process.cwd())
    })
})

describe('helpers.appendLongResultHint', () => {
    test('returns original text when result size is within limits', () => {
        const text = 'line1\nline2'
        assert.strictEqual(appendLongResultHint(text, 2), text)
    })

    test('adds overflow hint when line count exceeds limit', () => {
        const lines = Array.from({ length: 400 }, (_, i) => `line-${i + 1}`).join('\n')
        const output = appendLongResultHint(lines, 400)
        assert.ok(output.includes('请细化查找范围'))
        assert.ok(output.includes('line-1'))
        assert.ok(!output.includes('line-400'))
    })

    test('truncates by character limit and appends overflow hint', () => {
        const prevLimit = process.env.MEMO_TOOL_RESULT_MAX_CHARS
        process.env.MEMO_TOOL_RESULT_MAX_CHARS = '1024'
        try {
            const longText = 'x'.repeat(12_050)
            const output = appendLongResultHint(longText, 1)
            const [body] = output.split('\n\n<system_hint>')
            assert.ok(output.includes('请细化查找范围'))
            assert.ok(body.length <= 1024)
        } finally {
            if (prevLimit === undefined) delete process.env.MEMO_TOOL_RESULT_MAX_CHARS
            else process.env.MEMO_TOOL_RESULT_MAX_CHARS = prevLimit
        }
    })
})
