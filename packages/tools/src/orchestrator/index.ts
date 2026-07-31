import type { CallToolResult } from '@modelcontextprotocol/sdk/types'
import { createApprovalManager } from '@memo/tools/approval'
import { getMaxToolResultChars } from '@memo/tools/runtime/tool_output_limits'
import type {
    ToolAction,
    ToolActionResult,
    ToolActionErrorType,
    ToolApprovalHooks,
    ToolExecutionOptions,
    ToolExecutionResult,
    ToolOrchestrator,
    ToolOrchestratorConfig,
    OrchestratorTool,
} from './types'

const MAX_TOOL_INPUT_STRING_CHARS = 100_000

function escapeXmlAttr(value: string) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function estimateCallToolResultChars(result: CallToolResult) {
    let total = 0
    for (const item of result.content ?? []) {
        if (item.type === 'text') {
            total += item.text.length
            continue
        }
        try {
            total += JSON.stringify(item).length
        } catch {
            total += 100
        }
    }
    return total
}

function buildOversizeHintXml(toolName: string, actualChars: number, maxChars: number) {
    return `<system_hint type="tool_output_omitted" tool="${escapeXmlAttr(toolName)}" reason="too_long" actual_chars="${actualChars}" max_chars="${maxChars}">Tool output too long, automatically omitted. Please narrow the scope or add limit parameters and try again.</system_hint>`
}

function guardToolResultSize(toolName: string, result: CallToolResult): CallToolResult {
    const maxChars = getMaxToolResultChars()
    const actualChars = estimateCallToolResultChars(result)
    if (actualChars <= maxChars) return result
    return {
        content: [
            {
                type: 'text',
                text: buildOversizeHintXml(toolName, actualChars, maxChars),
            },
        ],
        isError: false,
    }
}

function flattenCallToolResult(result: CallToolResult): string {
    const texts =
        result.content?.flatMap((item) => {
            if (item.type === 'text') return [item.text]
            return []
        }) ?? []
    return texts.join('\n')
}

type ParseToolInputResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseToolInput(tool: OrchestratorTool, rawInput: unknown): ParseToolInputResult {
    let candidate: unknown = rawInput
    if (typeof rawInput === 'string') {
        if (rawInput.length > MAX_TOOL_INPUT_STRING_CHARS) {
            return {
                ok: false as const,
                error: `${tool.name} invalid input: input string too large (max ${MAX_TOOL_INPUT_STRING_CHARS} chars)`,
            }
        }
        const trimmed = rawInput.trim()
        if (trimmed) {
            try {
                candidate = JSON.parse(trimmed)
            } catch {
                candidate = trimmed
            }
        } else {
            candidate = {}
        }
    }

    if (!isRecord(candidate)) {
        return { ok: false as const, error: `${tool.name} invalid input: expected object` }
    }

    if (typeof tool.validateInput === 'function') {
        const validated = tool.validateInput(candidate)
        if (!validated.ok) return validated
        if (!isRecord(validated.data)) {
            return { ok: false as const, error: `${tool.name} invalid input: expected object` }
        }
        return { ok: true as const, data: validated.data }
    }

    return { ok: true as const, data: candidate }
}

function classifyExecutionError(err: unknown): ToolActionErrorType {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
    if (
        message.includes('sandbox') ||
        message.includes('permission denied') ||
        message.includes('operation not permitted') ||
        message.includes('eacces')
    ) {
        return 'sandbox_denied'
    }
    return 'execution_failed'
}

class ToolOrchestratorImpl implements ToolOrchestrator {
    readonly approvalManager

    constructor(private config: ToolOrchestratorConfig) {
        this.approvalManager = createApprovalManager(config.approval)
    }

    async executeAction(action: ToolAction, options?: ToolApprovalHooks): Promise<ToolActionResult> {
        const startedAt = Date.now()
        const actionId = action.id ?? `${action.name}:${startedAt}`
        const check = this.approvalManager.check(action.name, action.input)

        if (check.needApproval) {
            const request = {
                toolName: check.toolName,
                params: check.params,
                fingerprint: check.fingerprint,
                riskLevel: check.riskLevel,
                reason: check.reason,
            }

            await options?.onApprovalRequest?.(request)

            const decision = options?.requestApproval ? await options.requestApproval(request) : 'deny'
            this.approvalManager.recordDecision(check.fingerprint, decision)

            await options?.onApprovalResponse?.({
                fingerprint: check.fingerprint,
                decision,
            })

            if (decision === 'deny') {
                return {
                    actionId,
                    tool: action.name,
                    status: 'approval_denied',
                    errorType: 'approval_denied',
                    success: false,
                    observation: `User denied tool execution: ${action.name}`,
                    durationMs: Date.now() - startedAt,
                    rejected: true,
                }
            }
        }

        const tool = this.config.tools[action.name]
        if (!tool) {
            return {
                actionId,
                tool: action.name,
                status: 'tool_not_found',
                errorType: 'tool_not_found',
                success: false,
                observation: `Unknown tool: ${action.name}`,
                durationMs: Date.now() - startedAt,
            }
        }

        try {
            const parsedInput = parseToolInput(tool, action.input)
            if (!parsedInput.ok) {
                return {
                    actionId,
                    tool: action.name,
                    status: 'input_invalid',
                    errorType: 'input_invalid',
                    success: false,
                    observation: parsedInput.error,
                    durationMs: Date.now() - startedAt,
                }
            }

            const rawResult = await tool.execute(parsedInput.data)
            const result = guardToolResultSize(action.name, rawResult)
            return {
                actionId,
                tool: action.name,
                status: 'success',
                success: true,
                observation: flattenCallToolResult(result) || '(no tool output)',
                durationMs: Date.now() - startedAt,
            }
        } catch (err) {
            const errorType = classifyExecutionError(err)
            return {
                actionId,
                tool: action.name,
                status: errorType,
                errorType,
                success: false,
                observation: `Tool execution failed: ${(err as Error).message}`,
                durationMs: Date.now() - startedAt,
            }
        }
    }

    async executeActions(actions: ToolAction[], options: ToolExecutionOptions = {}): Promise<ToolExecutionResult> {
        const executionMode = options.executionMode ?? 'sequential'
        const failurePolicy = options.failurePolicy ?? (options.stopOnRejection === false ? 'collect_all' : 'fail_fast')

        let results: ToolActionResult[] = []

        if (executionMode === 'parallel') {
            const parallelResults = await Promise.all(actions.map((action) => this.executeAction(action, options)))
            if (failurePolicy === 'fail_fast') {
                const firstRejected = parallelResults.findIndex((result) => result.rejected)
                results = firstRejected >= 0 ? parallelResults.slice(0, firstRejected + 1) : parallelResults
            } else {
                results = parallelResults
            }
        } else {
            for (const action of actions) {
                const result = await this.executeAction(action, options)
                results.push(result)
                if (result.rejected && failurePolicy === 'fail_fast') {
                    break
                }
            }
        }

        const hasRejection = results.some((result) => result.rejected)
        const combinedObservation = results.map((result) => `[${result.tool}]: ${result.observation}`).join('\n\n')

        return {
            results,
            combinedObservation,
            hasRejection,
            executionMode,
            failurePolicy,
        }
    }

    clearOnceApprovals(): void {
        this.approvalManager.clearOnceApprovals()
    }

    dispose(): void {
        this.approvalManager.dispose()
    }
}

export function createToolOrchestrator(config: ToolOrchestratorConfig): ToolOrchestrator {
    return new ToolOrchestratorImpl(config)
}

export type {
    ToolAction,
    ToolActionResult,
    ToolActionErrorType,
    ToolActionStatus,
    ToolApprovalHooks,
    ToolExecutionOptions,
    ToolExecutionResult,
    ToolOrchestrator,
    ToolOrchestratorConfig,
    OrchestratorTool,
    OrchestratorToolRegistry,
} from './types'
