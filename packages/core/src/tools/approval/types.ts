/** @file Tool approval system type definitions */

/** Tool risk level */
export type RiskLevel = 'read' | 'write' | 'execute'

/** User approval decision */
export type ApprovalDecision = 'once' | 'session' | 'deny'

/** Approval mode */
export type ApprovalMode = 'dangerous' | 'auto' | 'strict'

/** Authorization cache key (fingerprint) */
export type ApprovalKey = string

/** Approval check result */
export type ApprovalCheckResult =
    | { needApproval: false; decision: 'auto-execute' }
    | {
          needApproval: true
          fingerprint: ApprovalKey
          riskLevel: RiskLevel
          reason: string
          toolName: string
          params: unknown
      }

/** Approval request (for UI display) */
export interface ApprovalRequest {
    toolName: string
    params: unknown
    fingerprint: ApprovalKey
    riskLevel: RiskLevel
    reason: string
}

/** Approval manager configuration */
export interface ApprovalManagerConfig {
    /** Approval mode */
    mode?: ApprovalMode
    /** Whether dangerous mode (bypass all approvals) */
    dangerous?: boolean
    /** Custom tool risk level mapping */
    toolRiskLevels?: Record<string, RiskLevel>
}

/** Approval manager interface */
export interface ApprovalManager {
    /** Whether dangerous mode */
    readonly isDangerousMode: boolean

    /** Get tool risk level */
    getRiskLevel(toolName: string): RiskLevel

    /** Check if tool call requires approval */
    check(toolName: string, params: unknown): ApprovalCheckResult

    /** Record user decision */
    recordDecision(fingerprint: ApprovalKey, decision: ApprovalDecision): void

    /** Check if a fingerprint is already authorized */
    isGranted(fingerprint: ApprovalKey): boolean

    /** Clear once authorization (called when Turn ends) */
    clearOnceApprovals(): void

    /** Clear all authorizations (called when Session ends) */
    dispose(): void
}
