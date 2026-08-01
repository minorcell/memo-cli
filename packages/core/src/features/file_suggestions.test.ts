import assert from 'node:assert'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'vitest'
import {
    getFileSuggestions,
    invalidateFileSuggestionCache,
    normalizePath,
    type FileSuggestionRequest,
} from './file_suggestions'

const tempRoots: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
    tempRoots.push(dir)
    return dir
}

async function suggest(req: FileSuggestionRequest) {
    return getFileSuggestions(req)
}

afterEach(async () => {
    invalidateFileSuggestionCache()
    while (tempRoots.length > 0) {
        const root = tempRoots.pop()
        if (!root) continue
        await rm(root, { recursive: true, force: true })
    }
})

describe('file suggestions', () => {
    test('normalizePath keeps normalized separators for current platform', () => {
        assert.strictEqual(normalizePath('a/b/c'), 'a/b/c')
        assert.strictEqual(normalizePath('a//b//c'), 'a//b//c')
        assert.strictEqual(normalizePath('a/b/c'), 'a/b/c')
    })

    test('returns ranked suggestions for nested token query', async () => {
        const root = await makeTempDir('memo-file-suggest-rank')
        await mkdir(join(root, 'src', 'utils'), { recursive: true })
        await writeFile(join(root, 'src', 'index.ts'), 'export {}', 'utf8')
        await writeFile(join(root, 'src', 'utils', 'helper.ts'), 'export const helper = 1', 'utf8')
        await writeFile(join(root, 'README.md'), '# demo', 'utf8')

        const items = await suggest({
            cwd: root,
            query: 'src/he',
            limit: 5,
            maxDepth: 5,
            maxEntries: 500,
        })

        assert.ok(items.length > 0)
        assert.strictEqual(items[0]?.path, 'src/utils/helper.ts')
        assert.strictEqual(items[0]?.name, 'helper.ts')
        assert.strictEqual(items[0]?.parent, 'src/utils')
    })

    test('respects default ignore directories and custom ignore globs', async () => {
        const root = await makeTempDir('memo-file-suggest-ignore')
        await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
        await mkdir(join(root, 'logs'), { recursive: true })
        await mkdir(join(root, 'src', 'generated'), { recursive: true })
        await writeFile(join(root, 'node_modules', 'pkg', 'index.ts'), 'x', 'utf8')
        await writeFile(join(root, 'logs', 'app.log'), 'x', 'utf8')
        await writeFile(join(root, 'src', 'generated', 'client.ts'), 'x', 'utf8')
        await writeFile(join(root, 'src', 'main.ts'), 'x', 'utf8')

        const items = await suggest({
            cwd: root,
            query: 'src',
            ignoreGlobs: ['src/generated/**', '*.log'],
            maxDepth: 5,
            maxEntries: 500,
        })

        const paths = items.map((item) => item.path)
        assert.ok(paths.includes('src/main.ts'))
        assert.ok(!paths.some((path) => path.includes('node_modules')))
        assert.ok(!paths.some((path) => path.includes('generated/client.ts')))
        assert.ok(!paths.some((path) => path.endsWith('.log')))
    })

    test('applies .gitignore by default and can bypass with respectGitIgnore=false', async () => {
        const root = await makeTempDir('memo-file-suggest-gitignore')
        await mkdir(join(root, '.git'), { recursive: true })
        await writeFile(join(root, '.gitignore'), 'ignored.txt\n', 'utf8')
        await writeFile(join(root, 'ignored.txt'), 'ignored', 'utf8')
        await writeFile(join(root, 'visible.txt'), 'visible', 'utf8')

        const respected = await suggest({ cwd: root, query: '.txt', maxDepth: 2, maxEntries: 500 })
        const respectedPaths = respected.map((item) => item.path)
        assert.ok(respectedPaths.includes('visible.txt'))
        assert.ok(!respectedPaths.includes('ignored.txt'))

        const bypassed = await suggest({
            cwd: root,
            query: '.txt',
            maxDepth: 2,
            maxEntries: 500,
            respectGitIgnore: false,
        })
        const bypassedPaths = bypassed.map((item) => item.path)
        assert.ok(bypassedPaths.includes('visible.txt'))
        assert.ok(bypassedPaths.includes('ignored.txt'))
    })

    test('uses cache and supports cache invalidation for cwd and global reset', async () => {
        const root = await makeTempDir('memo-file-suggest-cache')
        await writeFile(join(root, 'first.ts'), 'first', 'utf8')

        const firstRun = await suggest({ cwd: root, query: '.ts', maxDepth: 2, maxEntries: 500 })
        assert.ok(firstRun.some((item) => item.path === 'first.ts'))

        await writeFile(join(root, 'second.ts'), 'second', 'utf8')
        const cachedRun = await suggest({
            cwd: root,
            query: 'second',
            maxDepth: 2,
            maxEntries: 500,
        })
        assert.ok(!cachedRun.some((item) => item.path === 'second.ts'))

        invalidateFileSuggestionCache(root)
        const refreshed = await suggest({
            cwd: root,
            query: 'second',
            maxDepth: 2,
            maxEntries: 500,
        })
        assert.ok(refreshed.some((item) => item.path === 'second.ts'))

        invalidateFileSuggestionCache()
        const afterGlobalClear = await suggest({
            cwd: root,
            query: '.ts',
            maxDepth: 2,
            maxEntries: 500,
        })
        assert.ok(afterGlobalClear.some((item) => item.path === 'first.ts'))
        assert.ok(afterGlobalClear.some((item) => item.path === 'second.ts'))
    })
})
