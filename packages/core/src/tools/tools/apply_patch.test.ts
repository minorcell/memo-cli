import assert from 'node:assert'
import type { Tool, ToolExecutionOptions } from 'ai'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import type { ToolOutput } from '@memo/core/tools/tools/mcp'
import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { runWithRuntimeContext } from '@memo/core/tools/runtime/context'
import { applyPatchTool } from '@memo/core/tools/tools/apply_patch'

let tempDir: string
let prevWritableRoots: string | undefined

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`)
    await mkdir(dir, { recursive: true })
    return dir
}

async function readText(path: string) {
    try {
        await access(path)
        return await readFile(path, 'utf8')
    } catch {
        return ''
    }
}

function textPayload(result: ToolOutput) {
    if (result.type === 'text' || result.type === 'error-text') return result.value ?? ''
    return ''
}

function assertPatchOk(result: ToolOutput) {
    const payload = textPayload(result)
    assert.ok(result.type !== 'error-text', payload)
}

function assertPatchError(result: ToolOutput, includes?: string) {
    assert.strictEqual(result.type, 'error-text')
    if (includes) {
        assert.ok(textPayload(result).includes(includes), textPayload(result))
    }
}

async function executePatch(input: string) {
    return runWithRuntimeContext({ cwd: tempDir }, () => runTool(applyPatchTool, { input }))
}

async function executePatchIn(cwd: string, input: string) {
    return runWithRuntimeContext({ cwd }, () => runTool(applyPatchTool, { input }))
}

beforeAll(async () => {
    tempDir = await makeTempDir('memo-tools-apply-patch')
    prevWritableRoots = process.env.MEMO_SANDBOX_WRITABLE_ROOTS
    process.env.MEMO_SANDBOX_WRITABLE_ROOTS = tempDir
})

afterAll(async () => {
    if (prevWritableRoots === undefined) {
        delete process.env.MEMO_SANDBOX_WRITABLE_ROOTS
    } else {
        process.env.MEMO_SANDBOX_WRITABLE_ROOTS = prevWritableRoots
    }
    await rm(tempDir, { recursive: true, force: true })
})

async function runTool(tool: Tool, input: unknown): Promise<ToolResultOutput> {
    return (await tool.execute!(input, {} as ToolExecutionOptions)) as ToolResultOutput
}

describe('apply_patch tool (structured patch)', () => {
    test('applies add/update/delete operations in one patch', async () => {
        await writeFile(join(tempDir, 'modify.txt'), 'line1\nline2\n', 'utf8')
        await writeFile(join(tempDir, 'delete.txt'), 'obsolete\n', 'utf8')

        const result = await executePatch(
            [
                '*** Begin Patch',
                '*** Add File: nested/new.txt',
                '+created',
                '*** Delete File: delete.txt',
                '*** Update File: modify.txt',
                '@@',
                '-line2',
                '+changed',
                '*** End Patch',
            ].join('\n'),
        )

        assertPatchOk(result)
        assert.strictEqual(await readText(join(tempDir, 'nested/new.txt')), 'created\n')
        assert.strictEqual(await readText(join(tempDir, 'modify.txt')), 'line1\nchanged\n')
        assert.strictEqual(await readText(join(tempDir, 'delete.txt')), '')

        const text = textPayload(result)
        assert.ok(text.includes('Success. Updated the following files:'))
        assert.ok(text.includes('A nested/new.txt'))
        assert.ok(text.includes('M modify.txt'))
        assert.ok(text.includes('D delete.txt'))
    })

    test('applies multiple update chunks on same file', async () => {
        const target = join(tempDir, 'multi.txt')
        await writeFile(target, 'line1\nline2\nline3\nline4\n', 'utf8')

        const result = await executePatch(
            [
                '*** Begin Patch',
                '*** Update File: multi.txt',
                '@@',
                '-line2',
                '+changed2',
                '@@',
                '-line4',
                '+changed4',
                '*** End Patch',
            ].join('\n'),
        )

        assertPatchOk(result)
        assert.strictEqual(await readText(target), 'line1\nchanged2\nline3\nchanged4\n')
    })

    test('supports move operation with update', async () => {
        const source = join(tempDir, 'old/name.txt')
        const destination = join(tempDir, 'renamed/dir/name.txt')
        await mkdir(join(tempDir, 'old'), { recursive: true })
        await writeFile(source, 'old content\n', 'utf8')

        const result = await executePatch(
            [
                '*** Begin Patch',
                '*** Update File: old/name.txt',
                '*** Move to: renamed/dir/name.txt',
                '@@',
                '-old content',
                '+new content',
                '*** End Patch',
            ].join('\n'),
        )

        assertPatchOk(result)
        assert.strictEqual(await readText(source), '')
        assert.strictEqual(await readText(destination), 'new content\n')
        assert.ok(textPayload(result).includes('M renamed/dir/name.txt'))
    })

    test('supports pure addition chunk at end of file', async () => {
        const target = join(tempDir, 'append.txt')
        await writeFile(target, 'foo\nbar\nbaz\n', 'utf8')

        const result = await executePatch(
            ['*** Begin Patch', '*** Update File: append.txt', '@@', '+quux', '*** End of File', '*** End Patch'].join(
                '\n',
            ),
        )

        assertPatchOk(result)
        assert.strictEqual(await readText(target), 'foo\nbar\nbaz\nquux\n')
    })

    test('adds trailing newline when updating file without newline', async () => {
        const target = join(tempDir, 'no_newline.txt')
        await writeFile(target, 'no newline at end', 'utf8')

        const result = await executePatch(
            [
                '*** Begin Patch',
                '*** Update File: no_newline.txt',
                '@@',
                '-no newline at end',
                '+first line',
                '+second line',
                '*** End Patch',
            ].join('\n'),
        )

        assertPatchOk(result)
        assert.strictEqual(await readText(target), 'first line\nsecond line\n')
    })

    test('tolerates whitespace-padded patch markers', async () => {
        const target = join(tempDir, 'padded.txt')
        await writeFile(target, 'before\n', 'utf8')

        const result = await executePatch(
            [' *** Begin Patch', '*** Update File: padded.txt', '@@', '-before', '+after', '*** End Patch '].join('\n'),
        )

        assertPatchOk(result)
        assert.strictEqual(await readText(target), 'after\n')
    })

    test('first update chunk may omit @@ marker', async () => {
        const target = join(tempDir, 'omit-marker.txt')
        await writeFile(target, 'import foo\n', 'utf8')

        const result = await executePatch(
            ['*** Begin Patch', '*** Update File: omit-marker.txt', ' import foo', '+bar', '*** End Patch'].join('\n'),
        )

        assertPatchOk(result)
        assert.strictEqual(await readText(target), 'import foo\nbar\n')
    })

    test('matches context lines with unicode punctuation normalization', async () => {
        const target = join(tempDir, 'unicode.txt')
        await writeFile(target, 'name: “Memo”\nstatus: ok\n', 'utf8')

        const result = await executePatch(
            [
                '*** Begin Patch',
                '*** Update File: unicode.txt',
                '@@',
                '-name: "Memo"',
                '+name: "Memo Code"',
                '*** End Patch',
            ].join('\n'),
        )

        assertPatchOk(result)
        assert.strictEqual(await readText(target), 'name: "Memo Code"\nstatus: ok\n')
    })

    test('rejects invalid begin marker', async () => {
        const result = await executePatch(['*** Start Patch', '*** End Patch'].join('\n'))
        assertPatchError(result, "The first line of the patch must be '*** Begin Patch'")
    })

    test('rejects invalid end marker', async () => {
        const result = await executePatch(['*** Begin Patch', '*** Add File: a.txt', '+hi'].join('\n'))
        assertPatchError(result, "The last line of the patch must be '*** End Patch'")
    })

    test('rejects invalid hunk header', async () => {
        const result = await executePatch(['*** Begin Patch', '*** Frobnicate File: foo', '*** End Patch'].join('\n'))
        assertPatchError(result, 'is not a valid hunk header')
    })

    test('rejects empty update hunk', async () => {
        const result = await executePatch(['*** Begin Patch', '*** Update File: foo.txt', '*** End Patch'].join('\n'))
        assertPatchError(result, "Update file hunk for path 'foo.txt' is empty")
    })

    test('rejects unexpected update hunk line prefix', async () => {
        await writeFile(join(tempDir, 'bad-line.txt'), 'hello\n', 'utf8')
        const result = await executePatch(
            ['*** Begin Patch', '*** Update File: bad-line.txt', '@@', '#not-valid', '*** End Patch'].join('\n'),
        )
        assertPatchError(result, 'Unexpected line found in update hunk')
    })

    test('allows absolute file paths inside writable roots', async () => {
        const absolutePath = join(tempDir, 'absolute.txt')
        const result = await executePatch(
            ['*** Begin Patch', `*** Add File: ${absolutePath}`, '+x', '*** End Patch'].join('\n'),
        )
        assertPatchOk(result)
        assert.strictEqual(await readText(absolutePath), 'x\n')
    })

    test('rejects absolute file paths outside writable roots', async () => {
        const outsidePath = join(tempDir, '..', 'outside-absolute.txt')
        const result = await executePatch(
            ['*** Begin Patch', `*** Add File: ${outsidePath}`, '+x', '*** End Patch'].join('\n'),
        )
        assertPatchError(result, 'sandbox write denied')
    })

    test('rejects empty file paths in headers', async () => {
        const result = await executePatch(['*** Begin Patch', '*** Add File: ', '*** End Patch'].join('\n'))
        assertPatchError(result, 'is not a valid hunk header')
    })

    test('rejects empty patch body', async () => {
        const result = await executePatch(['*** Begin Patch', '*** End Patch'].join('\n'))
        assertPatchError(result, 'No files were modified.')
    })

    test('returns error when update context cannot be found and keeps file unchanged', async () => {
        const target = join(tempDir, 'missing-context.txt')
        await writeFile(target, 'line1\nline2\n', 'utf8')

        const result = await executePatch(
            [
                '*** Begin Patch',
                '*** Update File: missing-context.txt',
                '@@',
                '-missing',
                '+changed',
                '*** End Patch',
            ].join('\n'),
        )

        assertPatchError(result, 'Failed to find expected lines in missing-context.txt')
        assert.strictEqual(await readText(target), 'line1\nline2\n')
    })

    test('requires @@ marker for non-first update chunks', async () => {
        const target = join(tempDir, 'second-chunk.txt')
        await writeFile(target, 'a\nb\nc\n', 'utf8')

        const result = await executePatch(
            [
                '*** Begin Patch',
                '*** Update File: second-chunk.txt',
                '@@',
                '-a',
                '+A',
                'not-a-context-marker',
                '-b',
                '+B',
                '*** End Patch',
            ].join('\n'),
        )

        assertPatchError(result, 'Expected update hunk to start with a @@ context marker')
        assert.strictEqual(await readText(target), 'a\nb\nc\n')
    })

    test('fails when update target file is missing', async () => {
        const result = await executePatch(
            ['*** Begin Patch', '*** Update File: missing.txt', '@@', '-old', '+new', '*** End Patch'].join('\n'),
        )
        assertPatchError(result, 'Failed to read file to update missing.txt')
    })

    test('fails when delete target file is missing', async () => {
        const result = await executePatch(
            ['*** Begin Patch', '*** Delete File: missing.txt', '*** End Patch'].join('\n'),
        )
        assertPatchError(result, 'Failed to read missing.txt')
    })

    test('denies writes outside writable roots via path traversal', async () => {
        const outsideDir = await makeTempDir('memo-tools-apply-patch-outside')
        const nestedCwd = join(outsideDir, 'nested')
        await mkdir(nestedCwd, { recursive: true })
        const previousRoots = process.env.MEMO_SANDBOX_WRITABLE_ROOTS
        process.env.MEMO_SANDBOX_WRITABLE_ROOTS = nestedCwd

        try {
            const result = await executePatchIn(
                nestedCwd,
                ['*** Begin Patch', '*** Add File: ../outside.txt', '+oops', '*** End Patch'].join('\n'),
            )
            assertPatchError(result, 'sandbox write denied')
        } finally {
            process.env.MEMO_SANDBOX_WRITABLE_ROOTS = previousRoots
            await rm(outsideDir, { recursive: true, force: true })
        }
    })

    test('denies add through symlinked parent directory to outside path', async () => {
        const outsideDir = await makeTempDir('memo-tools-apply-patch-symlink-outside')
        const linkDir = join(tempDir, 'linked')
        await symlink(outsideDir, linkDir)

        const result = await executePatch(
            ['*** Begin Patch', '*** Add File: linked/new.txt', '+hi', '*** End Patch'].join('\n'),
        )

        assertPatchError(result, 'sandbox write denied')
        assert.strictEqual(await readText(join(outsideDir, 'new.txt')), '')
        await rm(linkDir, { force: true })
        await rm(outsideDir, { recursive: true, force: true })
    })

    test('accepts heredoc-wrapped patch input in lenient mode', async () => {
        const result = await executePatch(
            ["<<'EOF'", '*** Begin Patch', '*** Add File: heredoc.txt', '+hi', '*** End Patch', 'EOF'].join('\n'),
        )

        assertPatchOk(result)
        assert.strictEqual(await readText(join(tempDir, 'heredoc.txt')), 'hi\n')
    })

    test('validates required input field', async () => {
        const result = await runTool(applyPatchTool, {} as never)
        assertPatchError(result, 'apply_patch invalid input')
    })
})
