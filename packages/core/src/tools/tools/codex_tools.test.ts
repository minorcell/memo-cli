import assert from 'node:assert'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { runWithRuntimeContext } from '@memo/core/tools/runtime/context'
import { execCommandTool } from '@memo/core/tools/tools/exec_command'
import { writeStdinTool } from '@memo/core/tools/tools/write_stdin'
import { applyPatchTool } from '@memo/core/tools/tools/apply_patch'
import { readTextFileTool } from '@memo/core/tools/tools/read_text_file'
import { readFilesTool } from '@memo/core/tools/tools/read_files'
import { listDirectoryTool } from '@memo/core/tools/tools/list_directory'
import { searchFilesTool } from '@memo/core/tools/tools/search_files'
import { updatePlanTool } from '@memo/core/tools/tools/update_plan'
import { getMemoryTool } from '@memo/core/tools/tools/get_memory'

let tempDir: string
let prevWritableRoots: string | undefined
let prevMemoHome: string | undefined
let prevFsAllowedRoots: string | undefined

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

function textPayload(result: { content?: Array<{ type: string; text?: string }> }) {
    const first = result.content?.find((item) => item.type === 'text')
    return first?.text ?? ''
}

function outputPayload(text: string) {
    const marker = 'Output:\n'
    const index = text.indexOf(marker)
    if (index < 0) return ''
    return text.slice(index + marker.length)
}

beforeAll(async () => {
    tempDir = await makeTempDir('memo-tools-codex')
    prevWritableRoots = process.env.MEMO_SANDBOX_WRITABLE_ROOTS
    prevMemoHome = process.env.MEMO_HOME
    prevFsAllowedRoots = process.env.MEMO_FS_ALLOWED_ROOTS
    process.env.MEMO_SANDBOX_WRITABLE_ROOTS = tempDir
    process.env.MEMO_HOME = tempDir
    process.env.MEMO_FS_ALLOWED_ROOTS = tempDir
})

afterAll(async () => {
    if (prevWritableRoots === undefined) {
        delete process.env.MEMO_SANDBOX_WRITABLE_ROOTS
    } else {
        process.env.MEMO_SANDBOX_WRITABLE_ROOTS = prevWritableRoots
    }
    if (prevMemoHome === undefined) {
        delete process.env.MEMO_HOME
    } else {
        process.env.MEMO_HOME = prevMemoHome
    }
    if (prevFsAllowedRoots === undefined) {
        delete process.env.MEMO_FS_ALLOWED_ROOTS
    } else {
        process.env.MEMO_FS_ALLOWED_ROOTS = prevFsAllowedRoots
    }
    await rm(tempDir, { recursive: true, force: true })
})

describe('codex shell family', () => {
    test('exec_command runs command and returns formatted output', async () => {
        const result = await execCommandTool.execute({ cmd: 'echo hello-codex' })
        const text = textPayload(result)
        assert.ok(text.includes('Output:'), 'should contain output section')
        assert.ok(text.includes('hello-codex'), 'should include command output')
    })

    test('exec_command blocks dangerous shell command with xml hint', async () => {
        const result = await execCommandTool.execute({ cmd: 'rm -rf /' })
        const text = textPayload(result)

        assert.ok(text.startsWith('<system_hint '))
        assert.ok(text.includes('reason="dangerous_command"'))
        assert.ok(text.includes('tool="exec_command"'))
    })

    test('write_stdin continues interactive session', async () => {
        const started = await execCommandTool.execute({
            cmd: 'read line; echo "$line"',
            yield_time_ms: 50,
        })
        const startedText = textPayload(started)
        const match = startedText.match(/session ID (\d+)/)
        assert.ok(match, `expected running session id, got: ${startedText}`)

        const sessionId = Number(match?.[1])
        const resumed = await writeStdinTool.execute({
            session_id: sessionId,
            chars: 'interactive-ok\n',
            yield_time_ms: 1000,
        })

        const resumedText = textPayload(resumed)
        assert.ok(resumedText.includes('interactive-ok'))
    })

    test('write_stdin blocks dangerous input and keeps session alive', async () => {
        const started = await execCommandTool.execute({
            cmd: 'read line; echo "$line"',
            yield_time_ms: 50,
        })
        const startedText = textPayload(started)
        const match = startedText.match(/session ID (\d+)/)
        assert.ok(match, `expected running session id, got: ${startedText}`)

        const sessionId = Number(match?.[1])
        const blocked = await writeStdinTool.execute({
            session_id: sessionId,
            chars: 'rm -rf /\n',
            yield_time_ms: 50,
        })
        const blockedText = textPayload(blocked)
        assert.ok(blockedText.startsWith('<system_hint '))
        assert.ok(blockedText.includes('tool="write_stdin"'))

        const resumed = await writeStdinTool.execute({
            session_id: sessionId,
            chars: 'still-alive\n',
            yield_time_ms: 1000,
        })
        const resumedText = textPayload(resumed)
        assert.ok(resumedText.includes('still-alive'))
    })

    test('write_stdin can fetch unread output tail after truncation', async () => {
        const started = await execCommandTool.execute({
            cmd: `node -e "process.stdout.write('X'.repeat(5000)); setTimeout(() => {}, 2000)"`,
            yield_time_ms: 300,
            max_output_tokens: 10,
        })
        const startedText = textPayload(started)
        const match = startedText.match(/session ID (\d+)/)
        assert.ok(match, `expected running session id, got: ${startedText}`)
        const sessionId = Number(match?.[1])
        let firstChunk = outputPayload(startedText)
        if (firstChunk.length === 0) {
            for (let i = 0; i < 5; i += 1) {
                const retry = await writeStdinTool.execute({
                    session_id: sessionId,
                    yield_time_ms: 100,
                    max_output_tokens: 10,
                })
                firstChunk = outputPayload(textPayload(retry))
                if (firstChunk.length > 0) break
            }
        }
        assert.strictEqual(firstChunk.length, 40)

        const next = await writeStdinTool.execute({
            session_id: sessionId,
            yield_time_ms: 100,
            max_output_tokens: 2000,
        })
        const nextText = textPayload(next)
        const nextChunk = outputPayload(nextText)
        assert.ok(nextChunk.length > 0, `expected unread tail, got: ${nextText}`)
        assert.ok(nextChunk.includes('X'))
    })

    test('exec_command rejects when active session cap is exceeded', async () => {
        const results = []
        for (let i = 0; i < 70; i += 1) {
            results.push(await execCommandTool.execute({ cmd: 'sleep 2', yield_time_ms: 0 }))
        }
        const overflow = results.find(
            (result) => result.isError && textPayload(result).includes('too many active sessions'),
        )
        assert.ok(overflow, 'expected active-session cap error')

        // Allow spawned sessions to exit before subsequent tests.
        await new Promise((resolve) => setTimeout(resolve, 2200))
    })
})

describe('codex file/search family', () => {
    test('apply_patch supports codex patch flow', async () => {
        const target = join(tempDir, 'patched.txt')
        await writeFile(target, 'alpha beta alpha', 'utf8')

        const singleRes = await runWithRuntimeContext({ cwd: tempDir }, () =>
            applyPatchTool.execute({
                input: [
                    '*** Begin Patch',
                    '*** Update File: patched.txt',
                    '@@',
                    '-alpha beta alpha',
                    '+A beta alpha',
                    '*** End Patch',
                ].join('\n'),
            }),
        )
        assert.ok(!singleRes.isError)
        assert.strictEqual(await readText(target), 'A beta alpha\n')

        const batchRes = await runWithRuntimeContext({ cwd: tempDir }, () =>
            applyPatchTool.execute({
                input: [
                    '*** Begin Patch',
                    '*** Update File: patched.txt',
                    '@@',
                    '-A beta alpha',
                    '+A B A',
                    '*** End Patch',
                ].join('\n'),
            }),
        )
        assert.ok(!batchRes.isError)
        assert.strictEqual(await readText(target), 'A B A\n')
    })

    test('read_text_file requires valid path in allowed roots', async () => {
        const result = await readTextFileTool.execute({ path: '/tmp/not-allowed.txt' })
        assert.strictEqual(result.isError, true)
        assert.ok(textPayload(result).includes('Access denied'))
    })

    test('list_directory lists entries with dir/file labels', async () => {
        const nested = join(tempDir, 'list-directory')
        await mkdir(nested, { recursive: true })
        await writeFile(join(nested, 'a.txt'), 'a', 'utf8')

        const result = await listDirectoryTool.execute({ path: nested })
        const text = textPayload(result)
        assert.ok(text.includes('[FILE] a.txt'), 'should include file label')
    })

    test('read_files reads multiple files in one call', async () => {
        const root = join(tempDir, 'read-files')
        await mkdir(root, { recursive: true })
        const fileA = join(root, 'a.txt')
        const fileB = join(root, 'b.txt')
        await writeFile(fileA, 'A', 'utf8')
        await writeFile(fileB, 'B', 'utf8')

        const result = await readFilesTool.execute({ paths: [fileA, fileB] })
        const text = textPayload(result)
        assert.ok(text.includes(`${fileA}:\nA`))
        assert.ok(text.includes(`${fileB}:\nB`))
    })

    test('search_files returns matching file paths', async () => {
        const searchRoot = join(tempDir, 'search-files')
        await mkdir(searchRoot, { recursive: true })
        await writeFile(join(searchRoot, 'm1.txt'), 'needle-here', 'utf8')
        await writeFile(join(searchRoot, 'm2.md'), 'nothing', 'utf8')

        const result = await searchFilesTool.execute({ pattern: '**/*.txt', path: searchRoot })
        const text = textPayload(result)
        assert.ok(text.includes('m1.txt'), 'should include file name')
        assert.ok(!text.includes('m2.md'))
    })
})

describe('codex workflow/context tools', () => {
    test('update_plan rejects multiple in_progress items', async () => {
        const result = await updatePlanTool.execute({
            plan: [
                { step: 'a', status: 'in_progress' },
                { step: 'b', status: 'in_progress' },
            ],
        })
        assert.strictEqual(result.isError, true)
        assert.ok(textPayload(result).includes('in_progress'))
    })

    test('get_memory reads from MEMO_HOME Agents.md', async () => {
        const memoryPath = join(tempDir, 'Agents.md')
        await writeFile(memoryPath, '## Memo Added Memories\n\n- prefers concise answers\n', 'utf8')
        const result = await getMemoryTool.execute({ memory_id: 'thread-1' })
        const text = textPayload(result)
        assert.ok(text.includes('prefers concise answers'))
    })
})
