import assert from 'node:assert'
import { describe, test, vi, beforeEach, afterEach, expect } from 'vitest'
import { shellTool } from './shell'
import { flattenText } from './mcp'

vi.mock('./exec_runtime', async () => {
    const actual = await vi.importActual('./exec_runtime')
    return {
        ...(actual as object),
        startExecSession: vi.fn(),
    }
})

import { startExecSession } from './exec_runtime'

describe('shell tool', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('basic execution', () => {
        test('joins argv and executes command', async () => {
            vi.mocked(startExecSession).mockResolvedValue('test output')

            const result = await shellTool.execute({ command: ['echo', 'hello'] })

            assert.strictEqual(result.isError, false)
            assert.strictEqual(flattenText(result), 'test output')
            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo hello',
                    source_tool: 'shell',
                }),
            )
        })

        test('handles single argument', async () => {
            vi.mocked(startExecSession).mockResolvedValue('single')

            await shellTool.execute({ command: ['echo', 'single'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo single',
                }),
            )
        })

        test('handles many arguments', async () => {
            vi.mocked(startExecSession).mockResolvedValue('many')

            await shellTool.execute({ command: ['echo', 'a', 'b', 'c', 'd', 'e'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo a b c d e',
                }),
            )
        })
    })

    describe('shell quoting for special characters', () => {
        test('quotes arguments with spaces', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', 'hello world'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo 'hello world'",
                }),
            )
        })

        test('quotes arguments with single quotes', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', "it's working"] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo 'it'\"'\"'s working'",
                }),
            )
        })

        test('handles empty arguments', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', ''] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo ''",
                }),
            )
        })

        test('quotes arguments with dollar signs', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', '$HOME'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo '$HOME'",
                }),
            )
        })

        test('quotes arguments with backticks', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', '`date`'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo '`date`'",
                }),
            )
        })

        test('quotes arguments with newlines', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', 'line1\nline2'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo 'line1\nline2'",
                }),
            )
        })

        test('quotes arguments with backslashes', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', 'path\\to\\file'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo 'path\\to\\file'",
                }),
            )
        })

        test('quotes arguments with semicolons', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', 'a;b;c'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo 'a;b;c'",
                }),
            )
        })

        test('quotes arguments with pipes', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', 'a|b'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo 'a|b'",
                }),
            )
        })

        test('quotes arguments with wildcards', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', '*.txt'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo '*.txt'",
                }),
            )
        })

        test('quotes arguments with angle brackets', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', '<tag>'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo '<tag>'",
                }),
            )
        })

        test('quotes arguments with ampersands', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', 'A&B'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo 'A&B'",
                }),
            )
        })

        test('does not quote safe arguments', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({
                command: ['echo', 'hello_world', 'file.txt', '/usr/local/bin'],
            })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo hello_world file.txt /usr/local/bin',
                }),
            )
        })

        test('handles mixed safe and unsafe arguments', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', 'safe', 'hello world', 'unsafe'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo safe 'hello world' unsafe",
                }),
            )
        })
    })

    describe('parameter passing', () => {
        test('passes optional workdir parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['pwd'], workdir: '/tmp' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    workdir: '/tmp',
                }),
            )
        })

        test('passes optional timeout_ms parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['sleep', '1'], timeout_ms: 5000 })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    yield_time_ms: 5000,
                    execution_timeout_ms: 5000,
                }),
            )
        })
    })

    describe('error handling', () => {
        test('handles execution errors gracefully', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('command failed'))

            const result = await shellTool.execute({ command: ['invalid-command'] })

            assert.strictEqual(result.isError, true)
            assert.ok(flattenText(result).includes('shell failed'))
        })

        test('handles command not found errors', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('ENOENT'))

            const result = await shellTool.execute({ command: ['definitely-not-real'] })

            assert.strictEqual(result.isError, true)
            assert.ok(flattenText(result).includes('shell failed'))
        })

        test('handles permission denied errors', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('EACCES: permission denied'))

            const result = await shellTool.execute({ command: ['/protected/path'] })

            assert.strictEqual(result.isError, true)
            assert.ok(flattenText(result).includes('shell failed'))
        })

        test('handles timeout errors', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('command timed out'))

            const result = await shellTool.execute({ command: ['sleep', '100'], timeout_ms: 100 })

            assert.strictEqual(result.isError, true)
            assert.ok(flattenText(result).includes('shell failed'))
        })
    })

    describe('unicode and special content', () => {
        test('handles unicode arguments', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', '你好世界'] })

            expect(startExecSession).toHaveBeenCalled()
        })

        test('handles emoji in arguments', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', '🌍🚀'] })

            expect(startExecSession).toHaveBeenCalled()
        })

        test('handles unicode with spaces', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await shellTool.execute({ command: ['echo', '你好 世界'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: "echo '你好 世界'",
                }),
            )
        })
    })
})
