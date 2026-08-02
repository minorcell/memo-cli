export type InterAgentCommunication = {
    author: string
    recipient: string
    content: string
    triggerTurn: boolean
}

export type InputQueueActivity = 'mailbox' | 'timeout' | 'closed' | 'aborted'

type ActivityWaiter = (activity: InputQueueActivity) => void

export class InputQueue {
    private messages: InterAgentCommunication[] = []
    private waiters = new Set<ActivityWaiter>()
    private closed = false

    enqueue(communication: InterAgentCommunication): void {
        if (this.closed) throw new Error('agent mailbox is closed')
        this.messages.push(communication)
        this.publish('mailbox')
    }

    hasMessages(): boolean {
        return this.messages.length > 0
    }

    hasTrigger(): boolean {
        return this.messages.some((message) => message.triggerTurn)
    }

    drainAll(): InterAgentCommunication[] {
        if (this.messages.length === 0) return []
        const drained = this.messages
        this.messages = []
        return drained
    }

    drainTriggeredBatch(): InterAgentCommunication[] {
        if (!this.hasTrigger()) return []
        return this.drainAll()
    }

    async waitForActivity(timeoutMs: number, signal?: AbortSignal): Promise<InputQueueActivity> {
        if (this.hasMessages()) return 'mailbox'
        if (this.closed) return 'closed'
        if (signal?.aborted) return 'aborted'

        return new Promise<InputQueueActivity>((resolve) => {
            let settled = false
            const finish = (activity: InputQueueActivity) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                signal?.removeEventListener('abort', onAbort)
                this.waiters.delete(finish)
                resolve(activity)
            }
            const onAbort = () => finish('aborted')
            const timer = setTimeout(() => finish('timeout'), timeoutMs)

            this.waiters.add(finish)
            signal?.addEventListener('abort', onAbort, { once: true })

            // Recheck after subscribing so an enqueue cannot be missed at the boundary.
            if (this.hasMessages()) finish('mailbox')
            else if (this.closed) finish('closed')
        })
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        this.publish('closed')
    }

    private publish(activity: InputQueueActivity): void {
        for (const waiter of this.waiters) waiter(activity)
    }
}

export function formatInterAgentCommunication(message: InterAgentCommunication): string {
    return `<agent_message author="${escapeAttribute(message.author)}" recipient="${escapeAttribute(
        message.recipient,
    )}">\n${message.content}\n</agent_message>`
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
