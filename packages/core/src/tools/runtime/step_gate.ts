/** @file Per-streamText-call tool execution gate: serializes mutating tools, skips after denial. */

export type StepPermit =
    | { skipped: true }
    | {
          skipped: false
          /** Must be called after the tool finishes (finally). */
          release: () => void
      }

export interface StepGate {
    /**
     * Acquire execution permission.
     * - exclusive (mutating or non-parallel tools): runs alone, FIFO order.
     * - shared (read-only parallel tools): runs concurrently unless an exclusive tool is queued/running.
     * - after markDenied, every acquire returns { skipped: true }.
     */
    acquire(exclusive: boolean): Promise<StepPermit>
    /** Deny the batch: subsequent tools in this step are skipped. */
    markDenied(): void
}

export function createStepGate(): StepGate {
    let denied = false
    let runningShared = 0
    let runningExclusive = false
    let queue: Array<{ exclusive: boolean; resolve: (permit: StepPermit) => void }> = []

    function drain() {
        if (denied) {
            const pending = queue
            queue = []
            for (const waiter of pending) waiter.resolve({ skipped: true })
            return
        }
        if (runningExclusive || queue.length === 0) return

        const first = queue[0]
        if (first?.exclusive) {
            if (runningShared > 0) return
            queue.shift()
            runningExclusive = true
            let released = false
            first.resolve({
                skipped: false,
                release: () => {
                    if (released) return
                    released = true
                    runningExclusive = false
                    drain()
                },
            })
            return
        }

        while (queue[0] && !queue[0].exclusive) {
            const waiter = queue.shift()
            if (!waiter) break
            runningShared += 1
            let released = false
            waiter.resolve({
                skipped: false,
                release: () => {
                    if (released) return
                    released = true
                    runningShared -= 1
                    drain()
                },
            })
        }
    }

    return {
        async acquire(exclusive) {
            if (denied) return { skipped: true }
            return new Promise<StepPermit>((resolve) => {
                queue.push({ exclusive, resolve })
                drain()
            })
        },
        markDenied() {
            denied = true
            drain()
        },
    }
}
