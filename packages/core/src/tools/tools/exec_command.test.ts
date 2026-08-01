import assert from 'node:assert'
import { describe, test, vi, beforeEach, afterEach, expect } from 'vitest'
import { execCommandTool } from './exec_command'
import { flattenText } from './mcp'

vi.mock('./exec_runtime', async () => {
    const actual = await vi.importActual('./exec_runtime')
    return {
        ...(actual as object),
        startExecSession: vi.fn(),
    }
})

import { startExecSession } from './exec_runtime'

describe('exec_command tool', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('basic execution', () => {
        test('executes command and returns output', async () => {
            vi.mocked(startExecSession).mockResolvedValue('test output')

            const result = await execCommandTool.execute({ cmd: 'echo hello' })

            assert.strictEqual(result.isError, false)
            assert.strictEqual(flattenText(result), 'test output')
            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo hello',
                    source_tool: 'exec_command',
                }),
            )
        })

        test('handles multi-line output', async () => {
            const multiLineOutput = 'Line 1\nLine 2\nLine 3'
            vi.mocked(startExecSession).mockResolvedValue(multiLineOutput)

            const result = await execCommandTool.execute({ cmd: 'printf "Line 1\nLine 2\nLine 3"' })

            assert.strictEqual(result.isError, false)
            assert.strictEqual(flattenText(result), multiLineOutput)
        })

        test('handles empty output', async () => {
            vi.mocked(startExecSession).mockResolvedValue('')

            const result = await execCommandTool.execute({ cmd: 'true' })

            assert.strictEqual(result.isError, false)
            assert.strictEqual(flattenText(result), '')
        })

        test('handles unicode output', async () => {
            const unicodeOutput = '你好世界 🌍 Привет мир'
            vi.mocked(startExecSession).mockResolvedValue(unicodeOutput)

            const result = await execCommandTool.execute({ cmd: 'echo "你好世界 🌍 Привет мир"' })

            assert.strictEqual(result.isError, false)
            assert.strictEqual(flattenText(result), unicodeOutput)
        })
    })

    describe('parameter passing', () => {
        test('passes optional workdir parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await execCommandTool.execute({ cmd: 'pwd', workdir: '/tmp' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    workdir: '/tmp',
                }),
            )
        })

        test('passes optional shell parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await execCommandTool.execute({ cmd: 'echo test', shell: '/bin/zsh' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    shell: '/bin/zsh',
                }),
            )
        })

        test('passes different shell types', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await execCommandTool.execute({ cmd: 'echo test', shell: '/usr/bin/fish' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    shell: '/usr/bin/fish',
                }),
            )
        })

        test('passes login parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await execCommandTool.execute({ cmd: 'whoami', login: true })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    login: true,
                }),
            )
        })

        test('passes tty parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await execCommandTool.execute({ cmd: 'top', tty: true })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    tty: true,
                }),
            )
        })

        test('passes yield_time_ms parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await execCommandTool.execute({ cmd: 'sleep 1', yield_time_ms: 10000 })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    yield_time_ms: 10000,
                }),
            )
        })

        test('passes max_output_tokens parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('truncated output')

            await execCommandTool.execute({ cmd: 'cat large_file.txt', max_output_tokens: 1000 })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    max_output_tokens: 1000,
                }),
            )
        })

        test('passes sandbox_permissions parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await execCommandTool.execute({ cmd: 'ls', sandbox_permissions: 'require_escalated' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    sandbox_permissions: 'require_escalated',
                }),
            )
        })

        test('passes justification parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await execCommandTool.execute({
                cmd: 'cat config',
                justification: 'Reading config for debugging',
            })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    justification: 'Reading config for debugging',
                }),
            )
        })

        test('passes prefix_rule parameter', async () => {
            vi.mocked(startExecSession).mockResolvedValue('output')

            await execCommandTool.execute({ cmd: 'ls -la', prefix_rule: ['safe'] })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    prefix_rule: ['safe'],
                }),
            )
        })
    })

    describe('error handling', () => {
        test('handles execution errors gracefully', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('command failed'))

            const result = await execCommandTool.execute({ cmd: 'invalid-command' })

            assert.strictEqual(result.isError, true)
            assert.ok(flattenText(result).includes('exec_command failed'))
            assert.ok(flattenText(result).includes('command failed'))
        })

        test('handles command not found errors', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('ENOENT: no such file or directory'))

            const result = await execCommandTool.execute({ cmd: 'definitely-not-a-command' })

            assert.strictEqual(result.isError, true)
            assert.ok(flattenText(result).includes('exec_command failed'))
        })

        test('handles permission denied errors', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('EACCES: permission denied'))

            const result = await execCommandTool.execute({ cmd: '/root/protected' })

            assert.strictEqual(result.isError, true)
            assert.ok(flattenText(result).includes('exec_command failed'))
        })

        test('handles timeout errors', async () => {
            vi.mocked(startExecSession).mockRejectedValue(new Error('command timed out after 30000ms'))

            const result = await execCommandTool.execute({ cmd: 'sleep 60', timeout_ms: 1000 })

            assert.strictEqual(result.isError, true)
            assert.ok(flattenText(result).includes('exec_command failed'))
        })
    })

    describe('command variations', () => {
        test('handles complex command with arguments', async () => {
            vi.mocked(startExecSession).mockResolvedValue('result')

            await execCommandTool.execute({
                cmd: 'grep -r "pattern" /path/to/search --include="*.js" -l',
            })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'grep -r "pattern" /path/to/search --include="*.js" -l',
                }),
            )
        })

        test('handles command with quotes', async () => {
            vi.mocked(startExecSession).mockResolvedValue('quoted')

            await execCommandTool.execute({ cmd: 'echo "hello world"' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo "hello world"',
                }),
            )
        })

        test('handles command with backticks', async () => {
            vi.mocked(startExecSession).mockResolvedValue('backtick')

            await execCommandTool.execute({ cmd: 'echo `date`' })

            expect(startExecSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: 'echo `date`',
                }),
            )
        })
    })
})
