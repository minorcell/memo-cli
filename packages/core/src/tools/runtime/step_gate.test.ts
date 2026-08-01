import { describe, expect, test } from 'vitest'
import { createStepGate, type StepPermit } from '@memo/core/tools/runtime/step_gate'

function release(permit: StepPermit) {
    if (!permit.skipped) permit.release()
}

describe('createStepGate', () => {
    test('grants the first exclusive acquire immediately', async () => {
        const gate = createStepGate()
        const permit = await gate.acquire(true)

        expect(permit.skipped).toBe(false)
        release(permit)
    })

    test('runs shared acquires together and gives queued exclusive work priority', async () => {
        const gate = createStepGate()
        const firstShared = await gate.acquire(false)
        const secondShared = await gate.acquire(false)
        const order: string[] = []
        let exclusiveStarted = false
        let lateSharedStarted = false

        const exclusivePromise = gate.acquire(true).then((permit) => {
            exclusiveStarted = true
            order.push('exclusive')
            return permit
        })
        const lateSharedPromise = gate.acquire(false).then((permit) => {
            lateSharedStarted = true
            order.push('late-shared')
            return permit
        })

        await Promise.resolve()
        expect(exclusiveStarted).toBe(false)
        expect(lateSharedStarted).toBe(false)

        release(firstShared)
        await Promise.resolve()
        expect(exclusiveStarted).toBe(false)

        release(secondShared)
        const exclusive = await exclusivePromise
        expect(order).toEqual(['exclusive'])
        expect(lateSharedStarted).toBe(false)

        release(exclusive)
        const lateShared = await lateSharedPromise
        expect(order).toEqual(['exclusive', 'late-shared'])
        release(lateShared)
    })

    test('serializes exclusive acquires in FIFO order', async () => {
        const gate = createStepGate()
        const first = await gate.acquire(true)
        const order: number[] = []

        const secondPromise = gate.acquire(true).then((permit) => {
            order.push(2)
            return permit
        })
        const thirdPromise = gate.acquire(true).then((permit) => {
            order.push(3)
            return permit
        })

        release(first)
        const second = await secondPromise
        expect(order).toEqual([2])

        release(second)
        const third = await thirdPromise
        expect(order).toEqual([2, 3])
        release(third)
    })

    test('skips queued and future acquires after denial', async () => {
        const gate = createStepGate()
        const running = await gate.acquire(true)
        const queuedPromise = gate.acquire(false)

        gate.markDenied()

        await expect(queuedPromise).resolves.toEqual({ skipped: true })
        await expect(gate.acquire(false)).resolves.toEqual({ skipped: true })
        release(running)
    })
})
