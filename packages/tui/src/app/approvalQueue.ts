import type { ApprovalDecision, ApprovalRequest } from '@memo/core'

type PendingApproval = {
    request: ApprovalRequest
    resolve: (decision: ApprovalDecision) => void
}

export class ApprovalQueue {
    private active: PendingApproval | null = null
    private pending: PendingApproval[] = []

    constructor(private onActiveChange: (request: ApprovalRequest | null) => void) {}

    request(request: ApprovalRequest): Promise<ApprovalDecision> {
        return new Promise((resolve) => {
            this.pending.push({ request, resolve })
            this.advance()
        })
    }

    decide(decision: ApprovalDecision): void {
        if (!this.active) return

        const current = this.active
        this.active = null
        current.resolve(decision)

        if (decision === 'deny') {
            const source = approvalSource(current.request)
            const retained: PendingApproval[] = []
            for (const item of this.pending) {
                if (approvalSource(item.request) === source) item.resolve('deny')
                else retained.push(item)
            }
            this.pending = retained
            this.advance()
            return
        }

        this.advance()
    }

    denyAll(): void {
        const active = this.active
        const pending = this.pending
        this.active = null
        this.pending = []

        active?.resolve('deny')
        for (const item of pending) item.resolve('deny')
        if (active || pending.length > 0) this.onActiveChange(null)
    }

    denySource(sessionId: string | undefined): void {
        if (!sessionId) return
        if (this.active?.request.sessionId === sessionId) {
            const current = this.active
            this.active = null
            current.resolve('deny')
        }
        const retained: PendingApproval[] = []
        for (const item of this.pending) {
            if (item.request.sessionId === sessionId) item.resolve('deny')
            else retained.push(item)
        }
        this.pending = retained
        if (!this.active) this.advance()
    }

    private advance(): void {
        if (this.active) return
        const next = this.pending.shift()
        if (!next) {
            this.onActiveChange(null)
            return
        }
        this.active = next
        this.onActiveChange(next.request)
    }
}

function approvalSource(request: ApprovalRequest): string {
    return request.sessionId ?? request.agentId ?? 'legacy'
}
