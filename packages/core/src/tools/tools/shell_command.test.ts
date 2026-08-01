import assert from 'node:assert'
import type { Tool, ToolExecutionOptions } from 'ai'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import { describe, test, vi, beforeEach, afterEach, expect } from 'vitest'
import { shellCommandTool } from './shell_command'
import { flattenText } from './mcp'

vi.mock('./exec_runtime', async () => {
    const actual = await vi.importActual('./exec_runtime')
    return {
        ...(actual as object),
        startExecSession: vi.fn(),
    }
})

import { startExecSession } from './exec_runtime'

async function runTool(tool: Tool, input: unknown): Promise<ToolResultOutput> {
    return (await tool.execute!(input, {} as ToolExecutionOptions)) as ToolResultOutput
}

describe('shell_command tool', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('basic execution', () => {
        test('executes command and returns output', async () => {
            vi.mocked(startExecSession).mockResolvedValue('test output')

            const result = await runTool(shellCommandTool, { command: 'echo hello' })

            assert.strictEqual(result.type, 'text')
            assert.strictEqual(flattenText(result), 'test output')
            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo hello',
                    source_tool: 'shell_command',
                }),
            )
        })

        test('handles multi-line output', async () => {
            const multiLineOutput = 'line1\nline2\nline3'
            vi.mocked(startExecSession).mockResolvedValue(multiLineOutput)

            const result = await runTool(shellCommandTool, {
                command: 'printf "line1\nline2\nline3"',
            })

            assert.strictEqual(result.type, 'text')
            assert.strictEqual(flattenText(result), multiLineOutput)
        })

        test('handles empty output', async () => {
            vi.mocked(startExecSession).mockResolvedValue('')

            const result = await runTool(shellCommandTool, { command: 'true' })

            assert.strictEqual(result.type, 'text')
            assert.strictEqual(flattenText(result), '')
        })
    })

    describe('parameter passing', () => {
        test('passes optional workdir parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await runTool(shellCommandTool, { command: 'pwd', workdir: '/tmp' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    workdir: '/tmp',
                }),
            )
        })

        test('passes optional login parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await runTool(shellCommandTool, { command: 'whoami', login: true })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    login: true,
                }),
            )
        })

        test('passes login=false explicitly', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await runTool(shellCommandTool, { command: 'echo test', login: false })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    login: false,
                }),
            )
        })

        test('passes timeout_ms as yield_time_ms and execution_timeout_ms', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await runTool(shellCommandTool, { command: 'sleep 1', timeout_ms: 5000 })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    yield_time_ms: 5000,
                    execution_timeout_ms: 5000,
                }),
            )
        })

        test('handles zero timeout_ms', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await runTool(shellCommandTool, { command: 'echo test', timeout_ms: 0 })

            expect(startExecSession).toHaveBeenCalled()
        })
    })

    describe('error handling', () => {
        test('handles execution errors gracefully', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('command failed'))

            const result = await runTool(shellCommandTool, { command: 'invalid-command' })

            assert.strictEqual(result.type, 'error-text')
            assert.ok(flattenText(result).includes('shell_command failed'))
        })

        test('includes original error message', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('ENOENT: no such file'))

            const result = await runTool(shellCommandTool, { command: 'nonexistent-cmd' })

            assert.strictEqual(result.type, 'error-text')
            assert.ok(flattenText(result).includes('ENOENT'))
        })

        test('handles timeout errors', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('command timed out after 5000ms'))

            const result = await runTool(shellCommandTool, { command: 'sleep 10', timeout_ms: 1000 })

            assert.strictEqual(result.type, 'error-text')
            assert.ok(flattenText(result).includes('shell_command failed'))
        })
    })

    describe('command variations', () => {
        test('handles commands with pipes', async () => {
            vi.mocked(startExecSession).mockResolvedValue('filtered output')

            await runTool(shellCommandTool, { command: 'cat file.txt | grep pattern' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'cat file.txt | grep pattern',
                }),
            )
        })

        test('handles commands with redirects', async () => {
            vi.mocked(startExecSession).mockResolvedValue('')

            await runTool(shellCommandTool, { command: 'echo hello > /tmp/output.txt' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo hello > /tmp/output.txt',
                }),
            )
        })

        test('handles commands with environment variables', async () => {
            vi.mocked(startExecSession).mockResolvedValue('test-value')

            await runTool(shellCommandTool, { command: 'echo $MY_VAR' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo $MY_VAR',
                }),
            )
        })

        test('handles long commands', async () => {
            const longCmd = Array(100).fill('echo test &&').join(' ') + ' echo done'
            vi.mocked(startExecSession).mockResolvedValue('done')

            await runTool(shellCommandTool, { command: longCmd })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: longCmd,
                }),
            )
        })
    })
})
