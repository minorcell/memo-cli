import assert from 'node:assert'
import { describe, test } from 'vitest'
import type { ApprovalRequest } from '@memo/core'
import { createInitialRuntimeState, runtimeReducer, runtimeStatus, type TurnRequest } from './runtimeState'

function turn(id: string): TurnRequest {
    return { id, input: id, displayInput: id }
}

const approval: ApprovalRequest = {
    toolName: 'exec_command',
    params: { cmd: 'pwd' },
    fingerprint: 'fp-1',
    riskLevel: 'execute',
    reason: 'runs a command',
}

describe('runtimeReducer', () => {
    test('runs one turn and drains queued turns in FIFO order', () => {
        let state = createInitialRuntimeState()
        state = runtimeReducer(state, { type: 'submit_turn', request: turn('first') })
        state = runtimeReducer(state, { type: 'submit_turn', request: turn('second') })
        state = runtimeReducer(state, { type: 'submit_turn', request: turn('third') })

        assert.strictEqual(state.active?.kind, 'turn')
        assert.strictEqual(state.active?.kind === 'turn' ? state.active.request.id : '', 'first')
        assert.deepStrictEqual(
            state.queuedTurns.map((request) => request.id),
            ['second', 'third'],
        )

        const firstOperationId = state.active?.id
        assert.ok(firstOperationId)
        state = runtimeReducer(state, { type: 'operation_finished', operationId: firstOperationId })
        assert.strictEqual(state.active?.kind === 'turn' ? state.active.request.id : '', 'second')

        const secondOperationId = state.active?.id
        assert.ok(secondOperationId)
        state = runtimeReducer(state, { type: 'operation_finished', operationId: secondOperationId })
        assert.strictEqual(state.active?.kind === 'turn' ? state.active.request.id : '', 'third')
    })

    test('queues turns during compaction and ignores duplicate compaction', () => {
        let state = runtimeReducer(createInitialRuntimeState(), { type: 'start_compact' })
        const compacting = state

        assert.strictEqual(runtimeStatus(state), 'compacting')
        assert.strictEqual(runtimeReducer(state, { type: 'start_compact' }), state)

        state = runtimeReducer(state, { type: 'submit_turn', request: turn('after-compact') })
        const operationId = compacting.active?.id
        assert.ok(operationId)
        state = runtimeReducer(state, { type: 'operation_finished', operationId })

        assert.strictEqual(runtimeStatus(state), 'running')
        assert.strictEqual(state.active?.kind === 'turn' ? state.active.request.id : '', 'after-compact')
    })

    test('tracks approval and cancellation as turn substates', () => {
        let state = runtimeReducer(createInitialRuntimeState(), { type: 'submit_turn', request: turn('first') })
        state = runtimeReducer(state, { type: 'approval_requested', request: approval })
        assert.strictEqual(runtimeStatus(state), 'awaiting_approval')

        state = runtimeReducer(state, { type: 'approval_resolved' })
        assert.strictEqual(runtimeStatus(state), 'running')

        state = runtimeReducer(state, { type: 'cancel_requested' })
        assert.strictEqual(runtimeStatus(state), 'cancelling')

        state = runtimeReducer(state, { type: 'approval_requested', request: approval })
        assert.strictEqual(runtimeStatus(state), 'awaiting_approval')
    })

    test('surfaces background approvals without an active root turn', () => {
        let state = runtimeReducer(createInitialRuntimeState(), { type: 'approval_requested', request: approval })
        assert.strictEqual(runtimeStatus(state), 'awaiting_approval')
        state = runtimeReducer(state, { type: 'approval_resolved' })
        assert.strictEqual(runtimeStatus(state), 'idle')
    })

    test('ignores stale operation completion', () => {
        const state = runtimeReducer(createInitialRuntimeState(), { type: 'submit_turn', request: turn('first') })
        assert.strictEqual(runtimeReducer(state, { type: 'operation_finished', operationId: 999 }), state)
    })

    test('keeps operation ids monotonic across reset', () => {
        let state = runtimeReducer(createInitialRuntimeState(), { type: 'submit_turn', request: turn('first') })
        const firstOperationId = state.active?.id
        state = runtimeReducer(state, { type: 'reset' })
        state = runtimeReducer(state, { type: 'submit_turn', request: turn('second') })

        assert.ok(firstOperationId)
        assert.ok(state.active)
        assert.ok(state.active.id > firstOperationId)
    })
})
