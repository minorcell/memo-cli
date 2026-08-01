import assert from 'node:assert'
import { afterEach, describe, test, vi } from 'vitest'
import { VisibleUpdateQueue, type VisibleUpdate } from './visibleUpdateQueue'

function assistantChunk(chunk: string): VisibleUpdate {
    return {
        kind: 'timeline',
        action: { type: 'assistant_chunk', turn: 1, step: 0, chunk },
    }
}

describe('VisibleUpdateQueue', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    test('batches adjacent streaming chunks until the interval elapses', async () => {
        vi.useFakeTimers()
        const dispatched: VisibleUpdate[] = []
        const queue = new VisibleUpdateQueue((update) => dispatched.push(update), 80)

        queue.enqueue(assistantChunk('one'))
        queue.enqueue(assistantChunk(' two'))
        assert.deepStrictEqual(dispatched, [])

        await vi.advanceTimersByTimeAsync(80)
        assert.deepStrictEqual(dispatched, [assistantChunk('one two')])
    })

    test('flushes pending chunks before an immediate timeline update', () => {
        vi.useFakeTimers()
        const dispatched: VisibleUpdate[] = []
        const queue = new VisibleUpdateQueue((update) => dispatched.push(update), 80)
        const action: VisibleUpdate = {
            kind: 'timeline',
            action: {
                type: 'tool_action',
                turn: 1,
                step: 0,
                action: { tool: 'read_text_file', input: { path: 'README.md' } },
            },
        }

        queue.enqueue(assistantChunk('before tool'))
        queue.enqueue(action)

        assert.deepStrictEqual(dispatched, [assistantChunk('before tool'), action])
    })

    test('preserves all visible updates while following is paused', async () => {
        vi.useFakeTimers()
        const dispatched: VisibleUpdate[] = []
        const queue = new VisibleUpdateQueue((update) => dispatched.push(update), 80)
        const context: VisibleUpdate = { kind: 'context', promptTokens: 120 }
        const plan: VisibleUpdate = { kind: 'plan', action: { type: 'clear' } }

        queue.setFollowing(false)
        queue.enqueue(assistantChunk('one'))
        queue.enqueue(assistantChunk(' two'))
        queue.enqueueMany([context, plan])
        await vi.advanceTimersByTimeAsync(200)
        assert.deepStrictEqual(dispatched, [])

        queue.setFollowing(true)
        assert.deepStrictEqual(dispatched, [assistantChunk('one two'), context, plan])
    })

    test('clear discards buffered updates', () => {
        const dispatched: VisibleUpdate[] = []
        const queue = new VisibleUpdateQueue((update) => dispatched.push(update))

        queue.setFollowing(false)
        queue.enqueue(assistantChunk('discard me'))
        queue.clear()
        queue.setFollowing(true)

        assert.deepStrictEqual(dispatched, [])
    })
})
