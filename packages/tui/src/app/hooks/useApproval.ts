import { useState, useRef, useCallback } from 'react'
import type { ApprovalDecision, ApprovalRequest } from '@memo/core'

export function useApproval() {
    const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null)
    const approvalResolverRef = useRef<((decision: ApprovalDecision) => void) | null>(null)

    const handleApprovalDecision = useCallback((decision: ApprovalDecision) => {
        const resolver = approvalResolverRef.current
        if (resolver) {
            resolver(decision)
            approvalResolverRef.current = null
        }
        setPendingApproval(null)
    }, [])

    return { pendingApproval, setPendingApproval, approvalResolverRef, handleApprovalDecision }
}
