/** @file Adapter from memo Tool registry to AI SDK tools: approval + truncation wrapper on execute. */
import { jsonSchema, type Tool as SdkTool, type ToolExecutionOptions, type ToolSet } from 'ai'

export type SdkToolSet = ToolSet
import type { MemoToolOutput, Tool, ToolRegistry } from '@memo/core/tools/router/types'
import type { ApprovalManager } from '@memo/core/tools/approval'
import type { ToolApprovalHooks } from '@memo/core/tools/orchestrator'
import { getMaxToolResultChars } from '@memo/core/tools/runtime/tool_output_limits'
import type { StepGate } from './step_gate'

const TOOL_SKIPPED_AFTER_REJECTION_MESSAGE = 'Skipped tool execution after previous rejection.'
const TOOL_SKIPPED_DISABLED_MESSAGE = 'Tool execution skipped: tools are disabled in current permission mode.'

/** Per-call context captured by the loop and closed over by the execute wrappers. */
export type ToolExecutionContext = {
    approvalManager: ApprovalManager
    approvalHooks: ToolApprovalHooks
    toolsDisabled: boolean
    onRepeatedAction: (tool: string, input: unknown) => void
    /** Fresh per streamText call. */
    gate: StepGate
}

function escapeXmlAttr(value: string) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildOversizeHintXml(toolName: string, actualChars: number, maxChars: number) {
    return `<system_hint type="tool_output_omitted" tool="${escapeXmlAttr(toolName)}" reason="too_long" actual_chars="${actualChars}" max_chars="${maxChars}">Tool output too long, automatically omitted. Please narrow the scope or add limit parameters and try again.</system_hint>`
}

function guardToolResultOutput(toolName: string, result: MemoToolOutput): MemoToolOutput {
    const maxChars = getMaxToolResultChars()
    const actualChars =
        result.type === 'text' || result.type === 'error-text'
            ? result.value.length
            : result.type === 'json'
              ? JSON.stringify(result.value).length
              : (result.reason?.length ?? 0)
    if (actualChars <= maxChars) return result
    return { type: 'text', value: buildOversizeHintXml(toolName, actualChars, maxChars) }
}

async function executeToolCall(
    tool: Tool,
    input: unknown,
    ctx: ToolExecutionContext,
    sdkOptions: ToolExecutionOptions,
): Promise<MemoToolOutput> {
    if (ctx.toolsDisabled) return { type: 'text', value: TOOL_SKIPPED_DISABLED_MESSAGE }

    const exclusive = tool.isMutating === true || tool.supportsParallelToolCalls === false
    const permit = await ctx.gate.acquire(exclusive)
    if (permit.skipped) return { type: 'text', value: TOOL_SKIPPED_AFTER_REJECTION_MESSAGE }

    try {
        // ① Approval (white-list → classifier → fingerprint cache), UI decision awaited inline.
        const check = ctx.approvalManager.check(tool.name, input)
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
                return { type: 'execution-denied', reason: `User denied tool execution: ${tool.name}` }
            }
        }

        // ② Input validation (SDK validates against jsonSchema; keep memo validators for strict semantics).
        const parsed = tool.validateInput ? tool.validateInput(input) : { ok: true as const, data: input }
        if (!parsed.ok) return { type: 'error-text', value: parsed.error }

        // ③ Execute + truncate.
        const raw = await tool.execute(parsed.data, { abortSignal: sdkOptions.abortSignal })
        return guardToolResultOutput(tool.name, raw)
    } catch (err) {
        if (sdkOptions.abortSignal?.aborted) throw err
        return { type: 'error-text', value: `Tool execution failed: ${(err as Error).message}` }
    } finally {
        permit.release()
    }
}

/** Build AI SDK tools from the memo Tool registry, wrapping execute with approval/truncation. */
export function buildSdkTools(tools: ToolRegistry, ctx: ToolExecutionContext): Record<string, SdkTool> | undefined {
    const entries = Object.values(tools)
    if (entries.length === 0) return undefined
    return Object.fromEntries(
        entries.map((tool) => [
            tool.name,
            {
                description: tool.description,
                inputSchema: jsonSchema(
                    tool.inputSchema?.type === 'object' ? tool.inputSchema : { ...tool.inputSchema, type: 'object' },
                ),
                metadata: {
                    memo: {
                        source: tool.source,
                        isMutating: tool.isMutating,
                        supportsParallelToolCalls: tool.supportsParallelToolCalls,
                    },
                },
                execute: (input: unknown, sdkOptions: ToolExecutionOptions) =>
                    executeToolCall(tool, input, ctx, sdkOptions),
            },
        ]),
    )
}
