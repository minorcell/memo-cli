import assert from 'node:assert'
import type { Tool, ToolExecutionOptions } from 'ai'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import type { ToolOutput } from '@memo/core/tools/tools/mcp'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { getMemoryTool } from '@memo/core/tools/tools/get_memory'

let tempDir: string
let prevMemoHome: string | undefined

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`)
    await mkdir(dir, { recursive: true })
    return dir
}

function textPayload(result: ToolOutput) {
    if (result.type === 'text' || result.type === 'error-text') return result.value ?? ''
    return ''
}

beforeAll(async () => {
    tempDir = await makeTempDir('memo-tools-get-memory')
    prevMemoHome = process.env.MEMO_HOME
    process.env.MEMO_HOME = tempDir
})

afterAll(async () => {
    if (prevMemoHome === undefined) {
        delete process.env.MEMO_HOME
    } else {
        process.env.MEMO_HOME = prevMemoHome
    }
    await rm(tempDir, { recursive: true, force: true })
})

async function runTool(tool: Tool, input: unknown): Promise<ToolResultOutput> {
    return (await tool.execute!(input, {} as ToolExecutionOptions)) as ToolResultOutput
}

describe('get_memory tool', () => {
    test('returns missing error when Agents.md does not exist', async () => {
        const result = await runTool(getMemoryTool, { memory_id: 'missing-thread' })
        assert.strictEqual(result.type, 'error-text')
        assert.ok(textPayload(result).includes('memory not found'))
    })

    test('reads Agents.md content into memory summary', async () => {
        const memoryPath = join(tempDir, 'Agents.md')
        await writeFile(memoryPath, '## Memo Added Memories\n\n- prefers concise output\n', 'utf8')

        const result = await runTool(getMemoryTool, { memory_id: 'thread-1' })
        assert.ok(result.type === 'text')

        const parsed = JSON.parse(textPayload(result))
        assert.strictEqual(parsed.memory_id, 'thread-1')
        assert.ok(String(parsed.memory_summary).includes('prefers concise output'))
    })
})
