import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { flattenText } from '@memo/tools/tools/mcp'
import { runBunTool } from '@memo/tools/tools/run_bun'

let originalTmpDir: string | undefined
let tempDir: string

beforeAll(async () => {
    originalTmpDir = process.env.TMPDIR
    tempDir = await mkdtemp(join(tmpdir(), 'memo-run-bun-test-'))
    process.env.TMPDIR = tempDir
})

afterAll(async () => {
    if (originalTmpDir === undefined) {
        delete process.env.TMPDIR
    } else {
        process.env.TMPDIR = originalTmpDir
    }
    await rm(tempDir, { recursive: true, force: true })
})

describe('run_bun tool', () => {
    test('supports top-level await and TS syntax', async () => {
        const code = `
            type User = { name: string }
            const user: User = { name: 'alice' }
            const val = await Promise.resolve(42)
            console.log(user.name, val)
        `
        const beforeFiles = await readdir(tempDir)
        expect(beforeFiles.length).toBe(0)

        const result = await runBunTool.execute({ code })
        const text = flattenText(result)

        expect(text).toContain('exit=0')
        expect(text).toContain('stdout:\nalice 42')
        expect(text).toContain('stderr:\n')

        const afterFiles = await readdir(tempDir)
        expect(afterFiles.length).toBe(0) // 临时文件被清理
    })

    test('propagates stderr and non-zero exit code on runtime error', async () => {
        const result = await runBunTool.execute({
            code: `
                console.error("oops")
                throw new Error("boom")
            `,
        })
        const text = flattenText(result)

        expect(text).toMatch(/exit=\d+/)
        expect(text).not.toContain('exit=0')
        expect(text).toContain('boom')
        expect(text).toContain('stderr:')
        expect(text).toContain('oops')
    })
})
