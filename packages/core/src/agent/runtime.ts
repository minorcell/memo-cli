import type { AgentSession } from '@memo/core/types'
import { formatInterAgentCommunication, type InterAgentCommunication, type InputQueue } from './communication'
import type { ExecutionLimiter, ExecutionPermit } from './registry'

export class AgentRuntime {
    private activeTurn: Promise<void> | null = null
    private shuttingDown = false

    constructor(
        private readonly session: AgentSession,
        readonly mailbox: InputQueue,
        private readonly limiter: ExecutionLimiter,
        private readonly onUnexpectedError: (error: Error) => void,
    ) {}

    deliver(communication: InterAgentCommunication): void {
        if (this.shuttingDown) throw new Error('agent is shutdown')

        if (communication.triggerTurn && !this.activeTurn) {
            const permit = this.limiter.tryAcquire()
            if (!permit) throw new Error('subagent concurrency limit reached')
            this.mailbox.enqueue(communication)
            this.startPendingTurn(permit)
            return
        }

        this.mailbox.enqueue(communication)
    }

    deliverWithPermit(communication: InterAgentCommunication, permit: ExecutionPermit): void {
        if (this.shuttingDown || this.activeTurn) {
            permit.release()
            throw new Error('agent cannot start its initial turn')
        }
        this.mailbox.enqueue(communication)
        this.startPendingTurn(permit)
    }

    wakePending(): boolean {
        if (this.shuttingDown || this.activeTurn || !this.mailbox.hasTrigger()) return false
        const permit = this.limiter.tryAcquire()
        if (!permit) return false
        this.startPendingTurn(permit)
        return true
    }

    interrupt(): void {
        this.session.cancelCurrentTurn?.('interrupted by another agent')
    }

    async shutdown(): Promise<void> {
        if (this.shuttingDown) {
            await this.activeTurn
            return
        }
        this.shuttingDown = true
        this.mailbox.close()
        this.session.cancelCurrentTurn?.('agent shutdown')
        await this.activeTurn
        await this.session.close()
    }

    get isRunning(): boolean {
        return this.activeTurn !== null
    }

    private startPendingTurn(permit: ExecutionPermit): void {
        const messages = this.mailbox.drainTriggeredBatch()
        if (messages.length === 0) {
            permit.release()
            return
        }

        const input = messages.map(formatInterAgentCommunication).join('\n\n')
        const running = this.session
            .runTurn(input)
            .then(() => {})
            .catch((error: unknown) => {
                this.onUnexpectedError(error instanceof Error ? error : new Error(String(error)))
            })
            .finally(() => {
                if (this.activeTurn === running) this.activeTurn = null
                permit.release()
            })
        this.activeTurn = running
    }
}
