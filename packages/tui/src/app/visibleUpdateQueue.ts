import type { PlanStateAction } from '../features/plan/planState'
import type { ChatTimelineAction } from '../features/timeline/chatTimeline'

export const STREAM_UPDATE_INTERVAL_MS = 80

export type VisibleUpdate =
    | { kind: 'timeline'; action: ChatTimelineAction }
    | { kind: 'plan'; action: PlanStateAction }
    | { kind: 'context'; promptTokens: number }

function isStreamingUpdate(update: VisibleUpdate): boolean {
    return (
        update.kind === 'timeline' &&
        (update.action.type === 'assistant_chunk' || update.action.type === 'reasoning_chunk')
    )
}

function mergeStreamingUpdates(previous: VisibleUpdate | undefined, next: VisibleUpdate): VisibleUpdate | null {
    if (!previous || previous.kind !== 'timeline' || next.kind !== 'timeline') return null
    const previousAction = previous.action
    const nextAction = next.action
    if (
        (previousAction.type !== 'assistant_chunk' && previousAction.type !== 'reasoning_chunk') ||
        nextAction.type !== previousAction.type ||
        nextAction.turn !== previousAction.turn ||
        nextAction.step !== previousAction.step
    ) {
        return null
    }

    return {
        kind: 'timeline',
        action: {
            ...previousAction,
            chunk: `${previousAction.chunk}${nextAction.chunk}`,
        },
    }
}

export class VisibleUpdateQueue {
    private readonly dispatch: (update: VisibleUpdate) => void
    private readonly intervalMs: number
    private pending: VisibleUpdate[] = []
    private timer: ReturnType<typeof setTimeout> | null = null
    private following = true

    constructor(dispatch: (update: VisibleUpdate) => void, intervalMs = STREAM_UPDATE_INTERVAL_MS) {
        this.dispatch = dispatch
        this.intervalMs = intervalMs
    }

    enqueue(update: VisibleUpdate): void {
        this.enqueueMany([update])
    }

    enqueueMany(updates: VisibleUpdate[]): void {
        let hasImmediateUpdate = false
        for (const update of updates) {
            const merged = mergeStreamingUpdates(this.pending[this.pending.length - 1], update)
            if (merged) {
                this.pending[this.pending.length - 1] = merged
            } else {
                this.pending.push(update)
            }
            if (!isStreamingUpdate(update)) hasImmediateUpdate = true
        }

        if (!this.following) return
        if (hasImmediateUpdate) {
            this.flush()
            return
        }
        this.scheduleFlush()
    }

    setFollowing(following: boolean): void {
        if (this.following === following) return
        this.following = following
        if (following) {
            this.flush()
        } else {
            this.cancelTimer()
        }
    }

    clear(): void {
        this.cancelTimer()
        this.pending = []
    }

    dispose(): void {
        this.clear()
    }

    private scheduleFlush(): void {
        if (this.timer) return
        this.timer = setTimeout(() => {
            this.timer = null
            this.flush()
        }, this.intervalMs)
    }

    private cancelTimer(): void {
        if (!this.timer) return
        clearTimeout(this.timer)
        this.timer = null
    }

    private flush(): void {
        if (!this.following || this.pending.length === 0) return
        this.cancelTimer()
        const updates = this.pending
        this.pending = []
        for (const update of updates) {
            this.dispatch(update)
        }
    }
}
