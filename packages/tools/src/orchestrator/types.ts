import type { CallToolResult } from '@modelcontextprotocol/sdk/types'
import type { ApprovalDecision, ApprovalManager, ApprovalManagerConfig, ApprovalRequest } from '@memo/tools/approval'

export type ToolValidateResult = { ok: true; data: unknown } | { ok: false; error: string }

export type OrchestratorTool = {
    name: string
    supportsParallelToolCalls?: boolean
    isMutating?: boolean
    validateInput?: (input: unknown) => ToolValidateResult
    execute: (input: unknown) => Promise<CallToolResult>
}

export type OrchestratorToolRegistry = Record<string, OrchestratorTool>

export type ToolAction = {
    id?: string
    name: string
    input: unknown
}

export type ToolActionErrorType =
    | 'approval_denied'
    | 'policy_denied'
    | 'sandbox_denied'
    | 'tool_not_found'
    | 'input_invalid'
    | 'execution_failed'

export type ToolActionStatus = 'success' | ToolActionErrorType
export type ToolExecutionMode = 'sequential' | 'parallel'
export type ToolFailurePolicy = 'fail_fast' | 'collect_all'

export type ToolActionResult = {
    actionId: string
    tool: string
    status: ToolActionStatus
    errorType?: ToolActionErrorType
    success: boolean
    observation: string
    durationMs: number
    rejected?: boolean
}

export type ToolExecutionResult = {
    results: ToolActionResult[]
    combinedObservation: string
    hasRejection: boolean
    executionMode: ToolExecutionMode
    failurePolicy: ToolFailurePolicy
}

export type ToolApprovalHooks = {
    onApprovalRequest?: (request: ApprovalRequest) => Promise<void> | void
    onApprovalResponse?: (payload: { fingerprint: string; decision: ApprovalDecision }) => Promise<void> | void
    requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>
}

export type ToolExecutionOptions = ToolApprovalHooks & {
    executionMode?: ToolExecutionMode
    failurePolicy?: ToolFailurePolicy
    /** @deprecated use failurePolicy */
    stopOnRejection?: boolean
}

export interface ToolOrchestrator {
    readonly approvalManager: ApprovalManager
    executeAction(action: ToolAction, options?: ToolApprovalHooks): Promise<ToolActionResult>
    executeActions(actions: ToolAction[], options?: ToolExecutionOptions): Promise<ToolExecutionResult>
    clearOnceApprovals(): void
    dispose(): void
}

export type ToolOrchestratorConfig = {
    tools: OrchestratorToolRegistry
    approval?: ApprovalManagerConfig
}
