import assert from 'node:assert'
import { describe, test } from 'vitest'
import { z } from 'zod'
import { createToolOrchestrator } from './index'

describe('tool orchestrator', () => {
    test('stops on rejection in sequential execution', async () => {
        const calls: string[] = []
        const orchestrator = createToolOrchestrator({
            tools: {
                shell_command: {
                    name: 'shell_command',
                    execute: async () => {
                        calls.push('shell_command')
                        return { content: [{ type: 'text', text: 'ok' }] }
                    },
                },
                read_file: {
                    name: 'read_file',
                    execute: async () => {
                        calls.push('read_file')
                        return { content: [{ type: 'text', text: 'read_file' }] }
                    },
                },
            },
        })

        const result = await orchestrator.executeActions(
            [
                { name: 'shell_command', input: { cmd: 'echo hi' } },
                { name: 'read_file', input: { file_path: '/tmp/a.txt' } },
            ],
            {
                requestApproval: async () => 'deny',
            },
        )

        assert.strictEqual(result.hasRejection, true)
        assert.deepStrictEqual(calls, [])
        assert.strictEqual(result.results.length, 1)
        assert.strictEqual(result.results[0]?.tool, 'shell_command')
        assert.strictEqual(result.results[0]?.status, 'approval_denied')
        assert.strictEqual(result.results[0]?.errorType, 'approval_denied')
        assert.strictEqual(result.results[0]?.rejected, true)
        assert.ok((result.results[0]?.durationMs ?? 0) >= 0)
        assert.ok(result.results[0]?.actionId.length)
    })

    test('executes tool when approval is granted', async () => {
        const orchestrator = createToolOrchestrator({
            tools: {
                apply_patch: {
                    name: 'apply_patch',
                    validateInput: (input) => {
                        const schema = z.object({
                            file_path: z.string(),
                            old_string: z.string(),
                            new_string: z.string(),
                        })
                        const parsed = schema.safeParse(input)
                        return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: 'invalid input' }
                    },
                    execute: async () => ({
                        content: [{ type: 'text', text: 'written' }],
                    }),
                },
            },
        })

        const result = await orchestrator.executeAction(
            {
                name: 'apply_patch',
                input: { file_path: '/tmp/a.txt', old_string: 'a', new_string: 'b' },
            },
            { requestApproval: async () => 'once' },
        )

        assert.strictEqual(result.success, true)
        assert.strictEqual(result.status, 'success')
        assert.strictEqual(result.observation, 'written')
        assert.ok(result.durationMs >= 0)
        assert.ok(result.actionId.length)
    })

    test('auto-approves subagent tools even in strict approval mode', async () => {
        let askedApproval = false
        const orchestrator = createToolOrchestrator({
            tools: {
                spawn_agent: {
                    name: 'spawn_agent',
                    execute: async () => ({
                        content: [{ type: 'text', text: 'spawned' }],
                    }),
                },
            },
            approval: {
                mode: 'strict',
            },
        })

        const result = await orchestrator.executeAction(
            { name: 'spawn_agent', input: { message: 'task' } },
            {
                requestApproval: async () => {
                    askedApproval = true
                    return 'deny'
                },
            },
        )

        assert.strictEqual(askedApproval, false)
        assert.strictEqual(result.success, true)
        assert.strictEqual(result.status, 'success')
        assert.strictEqual(result.observation, 'spawned')
    })

    test('returns unknown tool error', async () => {
        const orchestrator = createToolOrchestrator({ tools: {} })
        const result = await orchestrator.executeAction(
            { name: 'missing', input: {} },
            { requestApproval: async () => 'once' },
        )
        assert.strictEqual(result.success, false)
        assert.strictEqual(result.status, 'tool_not_found')
        assert.strictEqual(result.errorType, 'tool_not_found')
        assert.strictEqual(result.observation, 'Unknown tool: missing')
    })

    test('classifies sandbox-like execution failures', async () => {
        const orchestrator = createToolOrchestrator({
            tools: {
                exec_command: {
                    name: 'exec_command',
                    execute: async () => {
                        throw new Error('Permission denied by sandbox')
                    },
                },
            },
        })
        const result = await orchestrator.executeAction(
            { name: 'exec_command', input: { cmd: 'rm -rf /' } },
            { requestApproval: async () => 'once' },
        )
        assert.strictEqual(result.success, false)
        assert.strictEqual(result.status, 'sandbox_denied')
        assert.strictEqual(result.errorType, 'sandbox_denied')
        assert.ok(result.observation.startsWith('Tool execution failed:'))
    })

    test('replaces oversized tool output with xml system hint', async () => {
        const prevLimit = process.env.MEMO_TOOL_RESULT_MAX_CHARS
        process.env.MEMO_TOOL_RESULT_MAX_CHARS = '64'
        try {
            const orchestrator = createToolOrchestrator({
                tools: {
                    read_file: {
                        name: 'read_file',
                        execute: async () => ({
                            content: [{ type: 'text', text: 'x'.repeat(1000) }],
                        }),
                    },
                },
            })

            const result = await orchestrator.executeAction(
                { name: 'read_file', input: { file_path: '/tmp/a' } },
                { requestApproval: async () => 'once' },
            )

            assert.strictEqual(result.success, true)
            assert.strictEqual(result.status, 'success')
            assert.ok(result.observation.startsWith('<system_hint '))
            assert.ok(result.observation.includes('tool="read_file"'))
            assert.ok(result.observation.includes('reason="too_long"'))
            assert.ok(!result.observation.includes('x'.repeat(100)))
        } finally {
            if (prevLimit === undefined) {
                delete process.env.MEMO_TOOL_RESULT_MAX_CHARS
            } else {
                process.env.MEMO_TOOL_RESULT_MAX_CHARS = prevLimit
            }
        }
    })

    test('rejects oversized raw string input before json parsing', async () => {
        let executed = false
        const orchestrator = createToolOrchestrator({
            tools: {
                read_file: {
                    name: 'read_file',
                    execute: async () => {
                        executed = true
                        return { content: [{ type: 'text', text: 'ok' }] }
                    },
                },
            },
        })

        const result = await orchestrator.executeAction({
            name: 'read_file',
            input: 'x'.repeat(100_001),
        })

        assert.strictEqual(result.success, false)
        assert.strictEqual(result.status, 'input_invalid')
        assert.ok(result.observation.includes('input string too large'))
        assert.strictEqual(executed, false)
    })

    test('rejects non-object json input payloads', async () => {
        const orchestrator = createToolOrchestrator({
            tools: {
                read_file: {
                    name: 'read_file',
                    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
                },
            },
        })

        const result = await orchestrator.executeAction({
            name: 'read_file',
            input: '[]',
        })

        assert.strictEqual(result.success, false)
        assert.strictEqual(result.status, 'input_invalid')
        assert.ok(result.observation.includes('expected object'))
    })

    test('rejects validateInput success payload when shape is not object', async () => {
        const orchestrator = createToolOrchestrator({
            tools: {
                read_file: {
                    name: 'read_file',
                    validateInput: () => ({ ok: true, data: 'not-object' }),
                    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
                },
            },
        })

        const result = await orchestrator.executeAction({
            name: 'read_file',
            input: { file_path: '/tmp/a' },
        })

        assert.strictEqual(result.success, false)
        assert.strictEqual(result.status, 'input_invalid')
        assert.ok(result.observation.includes('expected object'))
    })
})
