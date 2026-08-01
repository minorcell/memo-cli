/** @file Runtime wrapping for standard AI SDK tools: approval + truncation wrapper on execute. */
import type { Tool, ToolExecutionOptions, ToolSet } from 'ai'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import type { ApprovalDecision, ApprovalManager, ApprovalRequest } from '@memo/core/tools/approval'
import { getMaxToolResultChars } from '@memo/core/tools/runtime/tool_output_limits'
import type { StepGate } from '@memo/core/tools/runtime/step_gate'
import type { SkillIndex } from '@memo/core/skills/skills'

const TOOL_SKIPPED_AFTER_REJECTION_MESSAGE = 'Skipped tool execution after previous rejection.'
export const TOOL_SKIPPED_DISABLED_MESSAGE = 'Tool execution skipped: tools are disabled in current permission mode.'

/** Approval UI hooks. */
export type ToolApprovalHooks = {
    onApprovalRequest?: (request: ApprovalRequest) => Promise<void> | void
    onApprovalResponse?: (payload: { fingerprint: string; decision: ApprovalDecision }) => Promise<void> | void
    requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>
}

/** Per-call context passed to tool execute wrappers via streamText experimental_context. */
export type ToolExecutionContext = {
    approvalManager: ApprovalManager
    approvalHooks: ToolApprovalHooks
    toolsDisabled: boolean
    /** Fresh per streamText call. */
    gate: StepGate
    /** Deduped skill snapshot for the current session (read_skill). */
    skillIndex?: SkillIndex
}

function escapeXmlAttr(value: string) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildOversizeHintXml(toolName: string, actualChars: number, maxChars: number) {
    return `<system_hint type="tool_output_omitted" tool="${escapeXmlAttr(toolName)}" reason="too_long" actual_chars="${actualChars}" max_chars="${maxChars}">Tool output too long, automatically omitted. Please narrow the scope or add limit parameters and try again.</system_hint>`
}

function guardToolResultOutput(toolName: string, result: ToolResultOutput): ToolResultOutput {
    const maxChars = getMaxToolResultChars()
    const actualChars =
        result.type === 'text' || result.type === 'error-text'
            ? result.value.length
            : result.type === 'json' || result.type === 'error-json'
              ? JSON.stringify(result.value).length
              : 0
    if (actualChars <= maxChars) return result
    return { type: 'text', value: buildOversizeHintXml(toolName, actualChars, maxChars) }
}

/**
 * Wrap a standard AI SDK ToolSet with the runtime execute wrapper (approval gate, skip,
 * truncation). The per-call context is read from `options.experimental_context`, so the
 * wrapper is built once at assembly time and reused across streamText calls.
 */
export function wrapToolSetWithRuntime(tools: ToolSet): ToolSet | undefined {
    const entries = Object.entries(tools)
    if (entries.length === 0) return undefined
    return Object.fromEntries(entries.map(([name, tool]) => [name, wrapTool(name, tool)]))
}

function wrapTool(name: string, tool: Tool): Tool {
    const execute = tool.execute
    if (typeof execute !== 'function') return tool
    const meta = tool.metadata?.memo as { isMutating?: boolean; supportsParallelToolCalls?: boolean } | undefined
    const exclusive = meta?.isMutating === true || meta?.supportsParallelToolCalls === false
    return {
        ...tool,
        execute: async (input, options: ToolExecutionOptions) => {
            const ctx = options.experimental_context as ToolExecutionContext
            if (ctx.toolsDisabled) return { type: 'error-text', value: TOOL_SKIPPED_DISABLED_MESSAGE }
            const permit = await ctx.gate.acquire(exclusive)
            if (permit.skipped) return { type: 'text', value: TOOL_SKIPPED_AFTER_REJECTION_MESSAGE }

            try {
                // Approval (white-list → classifier → fingerprint cache), UI decision awaited inline.
                const check = ctx.approvalManager.check(name, input)
                if (check.needApproval) {
                    const request = {
                        toolName: check.toolName,
                        params: check.params,
                        fingerprint: check.fingerprint,
                        riskLevel: check.riskLevel,
                        reason: check.reason,
                    }
                    await ctx.approvalHooks.onApprovalRequest?.(request)
                    const decision = ctx.approvalHooks.requestApproval
                        ? await ctx.approvalHooks.requestApproval(request)
                        : 'deny'
                    ctx.approvalManager.recordDecision(check.fingerprint, decision)
                    await ctx.approvalHooks.onApprovalResponse?.({ fingerprint: check.fingerprint, decision })
                    if (decision === 'deny') {
                        ctx.gate.markDenied()
                        return { type: 'execution-denied', reason: `User denied tool execution: ${name}` }
                    }
                }

                // Execute + truncate. Input validation is handled by the SDK inputSchema.
                const raw = await execute(input, options)
                return guardToolResultOutput(name, raw as ToolResultOutput)
            } catch (err) {
                if (options.abortSignal?.aborted) throw err
                return { type: 'error-text', value: `Tool execution failed: ${(err as Error).message}` }
            } finally {
                permit.release()
            }
        },
    }
}
