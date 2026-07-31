import assert from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, test } from 'vitest'
import { readTextFileTool } from '@memo/tools/tools/read_text_file'
import { readMediaFileTool } from '@memo/tools/tools/read_media_file'
import { readFilesTool } from '@memo/tools/tools/read_files'
import { writeFileTool } from '@memo/tools/tools/write_file'
import { editFileTool } from '@memo/tools/tools/edit_file'
import { listDirectoryTool } from '@memo/tools/tools/list_directory'
import { searchFilesTool } from '@memo/tools/tools/search_files'

type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

function textPayload(result: ToolResult): string {
    const first = result.content?.find((item) => item.type === 'text')
    return first?.text ?? ''
}

let rootDir = ''
let outsideDir = ''
let prevAllowedRoots: string | undefined

beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'memo-tools-fs-root-'))
    outsideDir = await mkdtemp(join(tmpdir(), 'memo-tools-fs-outside-'))
    prevAllowedRoots = process.env.MEMO_FS_ALLOWED_ROOTS
    process.env.MEMO_FS_ALLOWED_ROOTS = rootDir
})

afterEach(async () => {
    if (prevAllowedRoots === undefined) {
        delete process.env.MEMO_FS_ALLOWED_ROOTS
    } else {
        process.env.MEMO_FS_ALLOWED_ROOTS = prevAllowedRoots
    }

    await rm(rootDir, { recursive: true, force: true })
    await rm(outsideDir, { recursive: true, force: true })
})

describe('filesystem tools', () => {
    test('tool schemas reject invalid empty path input', () => {
        const readValidation = readTextFileTool.validateInput?.({ path: '' })
        assert.strictEqual(readValidation?.ok, false)

        const listValidation = listDirectoryTool.validateInput?.({ path: '' })
        assert.strictEqual(listValidation?.ok, false)
    })

    test('read_text_file reads full content and supports head/tail', async () => {
        const filePath = join(rootDir, 'a.txt')
        await writeFile(filePath, 'line1\nline2\nline3\n', 'utf8')

        const full = await readTextFileTool.execute({ path: filePath })
        assert.strictEqual(full.isError, false)
        assert.strictEqual(textPayload(full), 'line1\nline2\nline3\n')

        const head = await readTextFileTool.execute({ path: filePath, head: 2 })
        assert.strictEqual(head.isError, false)
        assert.strictEqual(textPayload(head), 'line1\nline2')

        const tail = await readTextFileTool.execute({ path: filePath, tail: 2 })
        assert.strictEqual(tail.isError, false)
        assert.strictEqual(textPayload(tail), 'line3\n')

        const invalid = await readTextFileTool.execute({ path: filePath, head: 1, tail: 1 })
        assert.strictEqual(invalid.isError, true)
        assert.ok(textPayload(invalid).includes('Cannot specify both head and tail'))
    })

    test('read_media_file returns json payload with type/mimeType/data', async () => {
        const filePath = join(rootDir, 'img.png')
        await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

        const result = await readMediaFileTool.execute({ path: filePath })
        assert.strictEqual(result.isError, false)

        const payload = JSON.parse(textPayload(result)) as {
            type: string
            mimeType: string
            data: string
        }

        assert.strictEqual(payload.type, 'image')
        assert.strictEqual(payload.mimeType, 'image/png')
        assert.ok(payload.data.length > 0)
    })

    test('read_files keeps order and does not stop on single file failure', async () => {
        const first = join(rootDir, 'f1.txt')
        const second = join(rootDir, 'f2.txt')
        const missing = join(rootDir, 'missing.txt')
        await writeFile(first, 'one', 'utf8')
        await writeFile(second, 'two', 'utf8')

        const result = await readFilesTool.execute({ paths: [first, missing, second] })
        assert.strictEqual(result.isError, false)
        const text = textPayload(result)
        assert.ok(text.includes(`${first}:\none`))
        assert.ok(text.includes(`${missing}: Error -`))
        assert.ok(text.includes(`${second}:\ntwo`))
    })

    test('write_file writes and overwrites content', async () => {
        const filePath = join(rootDir, 'write.txt')

        const first = await writeFileTool.execute({ path: filePath, content: 'alpha' })
        assert.strictEqual(first.isError, false)
        assert.ok(textPayload(first).includes('Successfully wrote'))
        assert.strictEqual(await readFile(filePath, 'utf8'), 'alpha')

        const second = await writeFileTool.execute({ path: filePath, content: 'beta' })
        assert.strictEqual(second.isError, false)
        assert.strictEqual(await readFile(filePath, 'utf8'), 'beta')
    })

    test('write_file fails when parent directory is missing', async () => {
        const missingParentPath = join(rootDir, 'missing', 'write.txt')
        const result = await writeFileTool.execute({ path: missingParentPath, content: 'alpha' })
        assert.strictEqual(result.isError, true)
        assert.ok(textPayload(result).includes('Parent directory does not exist'))
    })

    test('edit_file supports dryRun and multi-edit apply', async () => {
        const filePath = join(rootDir, 'edit.ts')
        await writeFile(filePath, 'a\n  b\n  c\n', 'utf8')

        const dryRun = await editFileTool.execute({
            path: filePath,
            dryRun: true,
            edits: [{ oldText: '  b', newText: '  bb' }],
        })
        assert.strictEqual(dryRun.isError, false)
        const dryText = textPayload(dryRun)
        assert.ok(dryText.includes('```diff'))
        assert.strictEqual(await readFile(filePath, 'utf8'), 'a\n  b\n  c\n')

        const applied = await editFileTool.execute({
            path: filePath,
            edits: [
                { oldText: 'a', newText: 'aa' },
                { oldText: '  c', newText: '  cc' },
            ],
        })
        assert.strictEqual(applied.isError, false)
        assert.strictEqual(await readFile(filePath, 'utf8'), 'aa\n  b\n  cc\n')
    })

    test('edit_file returns error when an edit does not match', async () => {
        const filePath = join(rootDir, 'edit-error.ts')
        await writeFile(filePath, 'alpha\nbeta\n', 'utf8')

        const result = await editFileTool.execute({
            path: filePath,
            edits: [{ oldText: 'missing', newText: 'value' }],
        })
        assert.strictEqual(result.isError, true)
        assert.ok(textPayload(result).includes('Could not find exact match for edit'))
    })

    test('edit_file normalizes CRLF and supports multi-line replacement', async () => {
        const filePath = join(rootDir, 'edit-crlf.ts')
        await writeFile(filePath, 'line1\r\nline2\r\nline3\r\n', 'utf8')

        const result = await editFileTool.execute({
            path: filePath,
            edits: [{ oldText: 'line1\nline2', newText: 'line1\nline2-updated' }],
        })
        assert.strictEqual(result.isError, false)
        assert.ok(textPayload(result).includes('```diff'))
        assert.strictEqual(await readFile(filePath, 'utf8'), 'line1\nline2-updated\nline3\n')
    })

    test('list_directory outputs [DIR]/[FILE] labels', async () => {
        const nested = join(rootDir, 'nested')
        await mkdir(nested, { recursive: true })
        await writeFile(join(rootDir, 'file.txt'), 'x', 'utf8')

        const result = await listDirectoryTool.execute({ path: rootDir })
        assert.strictEqual(result.isError, false)

        const text = textPayload(result)
        assert.ok(text.includes('[DIR] nested'))
        assert.ok(text.includes('[FILE] file.txt'))
    })

    test('search_files supports pattern and excludePatterns', async () => {
        const srcDir = join(rootDir, 'src')
        await mkdir(srcDir, { recursive: true })
        await writeFile(join(rootDir, 'keep.txt'), 'k', 'utf8')
        await writeFile(join(rootDir, 'skip.log'), 's', 'utf8')
        await writeFile(join(srcDir, 'inside.txt'), 'i', 'utf8')

        const matched = await searchFilesTool.execute({
            path: rootDir,
            pattern: '**/*.txt',
            excludePatterns: ['src/**'],
        })
        assert.strictEqual(matched.isError, false)
        const text = textPayload(matched)
        assert.ok(text.includes(join(rootDir, 'keep.txt')))
        assert.ok(!text.includes(join(srcDir, 'inside.txt')))

        const none = await searchFilesTool.execute({ path: rootDir, pattern: '**/*.md' })
        assert.strictEqual(none.isError, false)
        assert.strictEqual(textPayload(none), 'No matches found')
    })

    test('denies access outside allowed roots', async () => {
        const outsideFile = join(outsideDir, 'outside.txt')
        await writeFile(outsideFile, 'outside', 'utf8')

        const result = await readTextFileTool.execute({ path: outsideFile })
        assert.strictEqual(result.isError, true)
        assert.ok(textPayload(result).includes('Access denied - path outside allowed directories'))
    })

    test('denies directory traversal relative path escaping root', async () => {
        const outsideFile = join(outsideDir, 'outside-traversal.txt')
        await writeFile(outsideFile, 'outside', 'utf8')

        const traversalPath = join('..', basename(outsideDir), 'outside-traversal.txt')
        const result = await readTextFileTool.execute({ path: traversalPath })

        assert.strictEqual(result.isError, true)
        assert.ok(textPayload(result).includes('Access denied - path outside allowed directories'))
    })

    test('denies symlink target escaping allowed roots', async () => {
        const outsideFile = join(outsideDir, 'outside-link.txt')
        await writeFile(outsideFile, 'outside', 'utf8')
        const linkedPath = join(rootDir, 'link-outside.txt')

        try {
            await symlink(outsideFile, linkedPath)
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'EPERM' || code === 'EACCES') {
                return
            }
            throw error
        }

        const result = await readTextFileTool.execute({ path: linkedPath })
        assert.strictEqual(result.isError, true)
        assert.ok(textPayload(result).includes('Access denied - symlink target outside allowed directories'))
    })
})
