import assert from 'node:assert'
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

            const result = await shellCommandTool.execute({ command: 'echo hello' })

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

            const result = await shellCommandTool.execute({
                command: 'printf "line1\nline2\nline3"',
            })

            assert.strictEqual(result.type, 'text')
            assert.strictEqual(flattenText(result), multiLineOutput)
        })

        test('handles empty output', async () => {
            vi.mocked(startExecSession).mockResolvedValue('')

            const result = await shellCommandTool.execute({ command: 'true' })

            assert.strictEqual(result.type, 'text')
            assert.strictEqual(flattenText(result), '')
        })
    })

    describe('parameter passing', () => {
        test('passes optional workdir parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellCommandTool.execute({ command: 'pwd', workdir: '/tmp' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    workdir: '/tmp',
                }),
            )
        })

        test('passes optional login parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellCommandTool.execute({ command: 'whoami', login: true })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    login: true,
                }),
            )
        })

        test('passes login=false explicitly', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellCommandTool.execute({ command: 'echo test', login: false })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    login: false,
                }),
            )
        })

        test('passes timeout_ms as yield_time_ms and execution_timeout_ms', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellCommandTool.execute({ command: 'sleep 1', timeout_ms: 5000 })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    yield_time_ms: 5000,
                    execution_timeout_ms: 5000,
                }),
            )
        })

        test('handles zero timeout_ms', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellCommandTool.execute({ command: 'echo test', timeout_ms: 0 })

            expect(startExecSession).toHaveBeenCalled()
        })
    })

    describe('error handling', () => {
        test('handles execution errors gracefully', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('command failed'))

            const result = await shellCommandTool.execute({ command: 'invalid-command' })

            assert.strictEqual(result.type, 'error-text')
            assert.ok(flattenText(result).includes('shell_command failed'))
        })

        test('includes original error message', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('ENOENT: no such file'))

            const result = await shellCommandTool.execute({ command: 'nonexistent-cmd' })

            assert.strictEqual(result.type, 'error-text')
            assert.ok(flattenText(result).includes('ENOENT'))
        })

        test('handles timeout errors', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('command timed out after 5000ms'))

            const result = await shellCommandTool.execute({ command: 'sleep 10', timeout_ms: 1000 })

            assert.strictEqual(result.type, 'error-text')
            assert.ok(flattenText(result).includes('shell_command failed'))
        })
    })

    describe('command variations', () => {
        test('handles commands with pipes', async () => {
            vi.mocked(startExecSession).mockResolvedValue('filtered output')

            await shellCommandTool.execute({ command: 'cat file.txt | grep pattern' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'cat file.txt | grep pattern',
                }),
            )
        })

        test('handles commands with redirects', async () => {
            vi.mocked(startExecSession).mockResolvedValue('')

            await shellCommandTool.execute({ command: 'echo hello > /tmp/output.txt' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo hello > /tmp/output.txt',
                }),
            )
        })

        test('handles commands with environment variables', async () => {
            vi.mocked(startExecSession).mockResolvedValue('test-value')

            await shellCommandTool.execute({ command: 'echo $MY_VAR' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo $MY_VAR',
                }),
            )
        })

        test('handles long commands', async () => {
            const longCmd = Array(100).fill('echo test &&').join(' ') + ' echo done'
            vi.mocked(startExecSession).mockResolvedValue('done')

            await shellCommandTool.execute({ command: longCmd })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: longCmd,
                }),
            )
        })
    })
})
