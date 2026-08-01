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
            const pending = this.pending
            this.pending = []
            for (const item of pending) item.resolve('deny')
            this.onActiveChange(null)
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
