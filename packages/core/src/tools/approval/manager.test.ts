import assert from 'node:assert'
import { describe, test } from 'vitest'
import { createApprovalManager } from './manager'

function assertNeedApproval(result: ReturnType<ReturnType<typeof createApprovalManager>['check']>) {
    assert.strictEqual(result.needApproval, true)
    if (!result.needApproval) {
        throw new Error('Expected approval to be required')
    }
    return result
}

describe('approval manager', () => {
    test('reuses session approval for the same tool across different params', () => {
        const manager = createApprovalManager({ mode: 'auto' })

        const first = assertNeedApproval(
            manager.check('apply_patch', {
                file_path: '/tmp/a.txt',
                old_string: 'a',
                new_string: 'b',
            }),
        )
        manager.recordDecision(first.fingerprint, 'session')

        const second = manager.check('apply_patch', {
            file_path: '/tmp/b.txt',
            old_string: 'x',
            new_string: 'y',
        })
        assert.strictEqual(second.needApproval, false)

        const third = manager.check('exec_command', { cmd: 'echo hi' })
        assert.strictEqual(third.needApproval, true)
    })

    test('applies once approval by tool until once approvals are cleared', () => {
        const manager = createApprovalManager({ mode: 'auto' })

        const first = assertNeedApproval(
            manager.check('apply_patch', {
                file_path: '/tmp/a.txt',
                old_string: 'a',
                new_string: 'b',
            }),
        )
        manager.recordDecision(first.fingerprint, 'once')

        const second = manager.check('apply_patch', {
            file_path: '/tmp/b.txt',
            old_string: 'x',
            new_string: 'y',
        })
        assert.strictEqual(second.needApproval, false)

        manager.clearOnceApprovals()

        const third = manager.check('apply_patch', {
            file_path: '/tmp/c.txt',
            old_string: 'k',
            new_string: 'v',
        })
        assert.strictEqual(third.needApproval, true)
    })

    test('tracks deny decisions by tool', () => {
        const manager = createApprovalManager({ mode: 'auto' })

        const first = assertNeedApproval(
            manager.check('apply_patch', {
                file_path: '/tmp/a.txt',
                old_string: 'a',
                new_string: 'b',
            }),
        )
        manager.recordDecision(first.fingerprint, 'deny')

        const second = assertNeedApproval(
            manager.check('apply_patch', {
                file_path: '/tmp/d.txt',
                old_string: 'd',
                new_string: 'e',
            }),
        )
        assert.strictEqual(second.reason, 'This request was previously denied.')

        const third = assertNeedApproval(manager.check('exec_command', { cmd: 'echo hi' }))
        assert.strictEqual(third.reason, 'Tool "exec_command" requires approval.')
    })
})
