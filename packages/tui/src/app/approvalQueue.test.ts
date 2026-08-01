import assert from 'node:assert'
import { describe, test } from 'vitest'
import type { ApprovalRequest } from '@memo/core'
import { ApprovalQueue } from './approvalQueue'

function request(fingerprint: string): ApprovalRequest {
    return {
        toolName: 'exec_command',
        params: { cmd: fingerprint },
        fingerprint,
        riskLevel: 'execute',
        reason: 'runs a command',
    }
}

describe('ApprovalQueue', () => {
    test('shows and resolves approvals one at a time', async () => {
        const active: Array<string | null> = []
        const queue = new ApprovalQueue((item) => active.push(item?.fingerprint ?? null))
        const first = queue.request(request('first'))
        const second = queue.request(request('second'))

        assert.deepStrictEqual(active, ['first'])
        queue.decide('once')
        assert.deepStrictEqual(active, ['first', 'second'])
        queue.decide('session')

        await assert.doesNotReject(async () => {
            assert.strictEqual(await first, 'once')
            assert.strictEqual(await second, 'session')
        })
        assert.deepStrictEqual(active, ['first', 'second', null])
    })

    test('denial rejects the remaining approval batch', async () => {
        const queue = new ApprovalQueue(() => {})
        const first = queue.request(request('first'))
        const second = queue.request(request('second'))

        queue.decide('deny')

        assert.strictEqual(await first, 'deny')
        assert.strictEqual(await second, 'deny')
    })

    test('denyAll resolves active and pending requests', async () => {
        const queue = new ApprovalQueue(() => {})
        const first = queue.request(request('first'))
        const second = queue.request(request('second'))

        queue.denyAll()

        assert.strictEqual(await first, 'deny')
        assert.strictEqual(await second, 'deny')
    })
})
