import assert from 'node:assert'
import type { MemoToolOutput } from '@memo/core/tools/router/types'
import { describe, test } from 'vitest'
import { shellTool } from '@memo/core/tools/tools/shell'
import { shellCommandTool } from '@memo/core/tools/tools/shell_command'
import { writeStdinTool } from '@memo/core/tools/tools/write_stdin'
import { updatePlanTool } from '@memo/core/tools/tools/update_plan'

function textPayload(result: MemoToolOutput) {
    if (result.type === 'text' || result.type === 'error-text') return result.value ?? ''
    return ''
}

describe('shell wrappers and update_plan', () => {
    test('shell tool executes argv command form', async () => {
        const result = await shellTool.execute({
            command: ['echo', 'shell-wrapper-ok'],
        })

        const text = textPayload(result)
        assert.ok(result.type === 'text')
        assert.ok(text.includes('shell-wrapper-ok'))
    })

    test('shell tool quotes dangerous shell metacharacters in argv', async () => {
        const literal = '$HOME $(echo hacked);`date`'
        const result = await shellTool.execute({
            command: ['printf', '%s', literal],
        })

        const text = textPayload(result)
        assert.ok(result.type === 'text')
        assert.ok(text.includes(literal))
        assert.ok(text.includes('$(echo hacked)'))
        assert.ok(text.includes('`date`'))
    })

    test('shell tool blocks dangerous argv command', async () => {
        const result = await shellTool.execute({
            command: ['mkfs.ext4', '/dev/sda'],
        })

        const text = textPayload(result)
        assert.ok(text.startsWith('<system_hint '))
        assert.ok(text.includes('tool="shell"'))
        assert.ok(text.includes('reason="dangerous_command"'))
    })

    test('shell tool enforces timeout_ms as execution deadline', async () => {
        const startedAt = Date.now()
        const result = await shellTool.execute({
            command: ['sleep', '2'],
            timeout_ms: 100,
        })

        const elapsedMs = Date.now() - startedAt
        const text = textPayload(result)
        assert.strictEqual(result.type, 'error-text')
        assert.ok(text.includes('timed out'))
        assert.ok(elapsedMs < 1_500)
    })

    test('shell_command executes script command form', async () => {
        const result = await shellCommandTool.execute({
            command: 'echo shell-command-ok',
            login: false,
            timeout_ms: 1000,
        })

        const text = textPayload(result)
        assert.ok(result.type === 'text')
        assert.ok(text.includes('shell-command-ok'))
    })

    test('shell_command blocks dangerous script command', async () => {
        const result = await shellCommandTool.execute({
            command: 'dd if=/dev/zero of=/dev/sda bs=1M',
            login: false,
            timeout_ms: 1000,
        })

        const text = textPayload(result)
        assert.ok(text.startsWith('<system_hint '))
        assert.ok(text.includes('tool="shell_command"'))
        assert.ok(text.includes('reason="dangerous_command"'))
    })

    test('shell_command enforces timeout_ms as execution deadline', async () => {
        const startedAt = Date.now()
        const result = await shellCommandTool.execute({
            command: 'sleep 2; echo too-late',
            login: false,
            timeout_ms: 100,
        })

        const elapsedMs = Date.now() - startedAt
        const text = textPayload(result)
        assert.strictEqual(result.type, 'error-text')
        assert.ok(text.includes('timed out'))
        assert.ok(elapsedMs < 1_500)
    })

    test('write_stdin fails for unknown session id', async () => {
        const result = await writeStdinTool.execute({ session_id: 999999, chars: 'noop' })
        assert.strictEqual(result.type, 'error-text')
        assert.ok(textPayload(result).includes('session_id 999999 not found'))
    })

    test('update_plan rejects 1-step task', async () => {
        const result = await updatePlanTool.execute({
            explanation: 'simple task',
            plan: [{ step: 'read_file package.json', status: 'pending' }],
        })

        const text = textPayload(result)
        assert.ok(text.startsWith('<system_hint '))
        assert.ok(text.includes('tool="update_plan"'))
        assert.ok(text.includes('reason="simple_task"'))
        assert.ok(text.includes('1 step'))
    })

    test('update_plan rejects 2-step task', async () => {
        const result = await updatePlanTool.execute({
            explanation: '2-step task',
            plan: [
                { step: 'step one', status: 'pending' },
                { step: 'step two', status: 'pending' },
            ],
        })

        const text = textPayload(result)
        assert.ok(text.includes('2 steps'))
    })

    test('update_plan rejects 3-step task', async () => {
        const result = await updatePlanTool.execute({
            explanation: '3-step task',
            plan: [
                { step: 'step one', status: 'completed' },
                { step: 'step two', status: 'in_progress' },
                { step: 'step three', status: 'pending' },
            ],
        })

        const text = textPayload(result)
        assert.ok(text.includes('3 steps'))
    })

    test('update_plan accepts 4-step task', async () => {
        const result = await updatePlanTool.execute({
            explanation: 'complex task',
            plan: [
                { step: 'step one', status: 'pending' },
                { step: 'step two', status: 'pending' },
                { step: 'step three', status: 'pending' },
                { step: 'step four', status: 'pending' },
            ],
        })

        assert.ok(result.type === 'text')
        const parsed = JSON.parse(textPayload(result))
        assert.strictEqual(parsed.message, 'Plan updated')
    })

    test('update_plan rejects too many in_progress', async () => {
        const result = await updatePlanTool.execute({
            explanation: 'invalid plan',
            plan: [
                { step: 'step one', status: 'in_progress' },
                { step: 'step two', status: 'in_progress' },
            ],
        })

        assert.ok(result.type === 'error-text')
        assert.ok(textPayload(result).includes('At most one step can be in_progress'))
    })
})
