import { describe, expect, test } from 'vitest'
import { InputQueue } from './communication'

describe('InputQueue', () => {
    test('wakes event-driven waiters without polling', async () => {
        const queue = new InputQueue()
        const waiting = queue.waitForActivity(1_000)
        queue.enqueue({ author: '/root/a', recipient: '/root', content: 'done', triggerTurn: false })
        await expect(waiting).resolves.toBe('mailbox')
    })

    test('only drains a triggered batch when it contains trigger work', () => {
        const queue = new InputQueue()
        queue.enqueue({ author: '/root', recipient: '/root/a', content: 'note', triggerTurn: false })
        expect(queue.drainTriggeredBatch()).toEqual([])
        queue.enqueue({ author: '/root', recipient: '/root/a', content: 'continue', triggerTurn: true })
        expect(queue.drainTriggeredBatch().map((message) => message.content)).toEqual(['note', 'continue'])
    })
})
