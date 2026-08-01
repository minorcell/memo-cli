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
    let exclusivePending = false
    let exclusiveChain: Promise<void> = Promise.resolve()
    let idleWaiters: Array<() => void> = []

    function isIdle() {
        return runningShared === 0 && !exclusivePending
    }

    function notifyIdle() {
        if (!isIdle()) return
        const waiters = idleWaiters
        idleWaiters = []
        for (const wake of waiters) wake()
    }

    function waitForIdle(): Promise<void> {
        if (isIdle()) return Promise.resolve()
        return new Promise((resolve) => idleWaiters.push(resolve))
    }

    return {
        async acquire(exclusive) {
            if (denied) return { skipped: true }
            if (exclusive) {
                exclusivePending = true
                await exclusiveChain
                await waitForIdle()
                if (denied) return { skipped: true }
                let releaseExclusive!: () => void
                exclusiveChain = new Promise((resolve) => (releaseExclusive = resolve))
                return {
                    skipped: false,
                    release: () => {
                        exclusivePending = false
                        releaseExclusive()
                        notifyIdle()
                    },
                }
            }
            // shared tool: wait for queued/running exclusive tools.
            await exclusiveChain
            if (exclusivePending) {
                await waitForIdle()
                if (denied) return { skipped: true }
            }
            runningShared += 1
            return {
                skipped: false,
                release: () => {
                    runningShared -= 1
                    notifyIdle()
                },
            }
        },
        markDenied() {
            denied = true
            notifyIdle()
        },
    }
}
