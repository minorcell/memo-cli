/** @file Tool approval system entry */

export type {
    ApprovalManager,
    ApprovalManagerConfig,
    ApprovalCheckResult,
    ApprovalRequest,
    ApprovalDecision,
    ApprovalKey,
    ApprovalMode,
    RiskLevel,
    ToolActionErrorType,
    ToolActionStatus,
} from './types'

export { createApprovalManager } from './manager'
export { createToolClassifier } from './classifier'
export { generateFingerprint, generatePartialFingerprint } from './fingerprint'
export { DEFAULT_TOOL_RISK_LEVELS, RISK_LEVEL_ORDER } from './constants'
