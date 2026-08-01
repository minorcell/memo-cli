import { afterEach, describe, expect, test, vi } from 'vitest'
import { jsonSchema, tool, type Tool, type ToolExecutionOptions, type ToolSet } from 'ai'
import { TOOL_SKIPPED_DISABLED_MESSAGE, wrapToolSetWithRuntime } from '@memo/core/tools/sdk_tools'
import type { ToolExecutionContext } from '@memo/core/tools/sdk_tools'
import type { ApprovalManager } from '@memo/core/tools/approval'

const TOOL_SKIPPED_AFTER_REJECTION_MESSAGE = 'Skipped tool execution after previous rejection.'

function makeCtx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
    return {
        approvalManager: {
            isDangerousMode: false,
            getRiskLevel: () => 'execute',
            check: () => ({ needApproval: false, decision: 'auto-execute' }),
            recordDecision: () => {},
            isGranted: () => false,
            clearOnceApprovals: () => {},
            dispose: () => {},
        },
        approvalHooks: {},
        toolsDisabled: false,
        gate: { acquire: async () => ({ skipped: false, release: () => {} }), markDenied: () => {} },
        ...overrides,
    }
}

function makeEcho(execute: Tool['execute'] = async () => ({ type: 'text', value: 'ok' })): Tool {
    return tool({
        description: 'echo',
        inputSchema: jsonSchema({ type: 'object' }),
        execute,
    })
}

async function runWrapped(tools: ToolSet, name: string, input: unknown, ctx: ToolExecutionContext) {
    const wrapped = wrapToolSetWithRuntime(tools)
    const wrappedTool = wrapped?.[name]
    expect(wrappedTool?.execute).toBeDefined()
    const options = { experimental_context: ctx } as unknown as ToolExecutionOptions
    return wrappedTool?.execute?.(input, options)
}

afterEach(() => {
    delete process.env.MEMO_TOOL_RESULT_MAX_CHARS
})

describe('wrapToolSetWithRuntime', () => {
    test('returns undefined for empty tool set', () => {
        expect(wrapToolSetWithRuntime({})).toBeUndefined()
    })

    test('executes the underlying tool and returns its output', async () => {
        const execute = vi.fn(async () => ({ type: 'text', value: 'ok' }))
        const output = await runWrapped({ echo: makeEcho(execute) }, 'echo', { text: 'hi' }, makeCtx())
        expect(output).toEqual({ type: 'text', value: 'ok' })
        expect(execute).toHaveBeenCalledWith({ text: 'hi' }, expect.anything())
    })

    test('returns the disabled sentinel (error-text) without executing when tools are disabled', async () => {
        const execute = vi.fn(async () => ({ type: 'text', value: 'must not run' }))
        const output = await runWrapped({ echo: makeEcho(execute) }, 'echo', {}, makeCtx({ toolsDisabled: true }))
        expect(output).toEqual({ type: 'error-text', value: TOOL_SKIPPED_DISABLED_MESSAGE })
        expect(execute).not.toHaveBeenCalled()
    })

    test('denies via approval manager: execution-denied + gate.markDenied', async () => {
        const markDenied = vi.fn()
        const requestApproval = vi.fn(async () => 'deny' as const)
        const onApprovalRequest = vi.fn()
        const onApprovalResponse = vi.fn()
        const recordDecision = vi.fn()
        const execute = vi.fn(async () => ({ type: 'text', value: 'must not run' }))
        const ctx = makeCtx({
            approvalManager: {
                ...makeCtx().approvalManager,
                check: () => ({
                    needApproval: true as const,
                    fingerprint: 'fp-1',
                    riskLevel: 'execute' as const,
                    reason: 'risky',
                    toolName: 'echo',
                    params: { text: 'hi' },
                }),
                recordDecision,
            },
            approvalHooks: { onApprovalRequest, onApprovalResponse, requestApproval },
            gate: { acquire: async () => ({ skipped: false, release: () => {} }), markDenied },
        })

        const output = await runWrapped({ echo: makeEcho(execute) }, 'echo', {}, ctx)

        expect(output).toEqual({ type: 'execution-denied', reason: 'User denied tool execution: echo' })
        expect(onApprovalRequest).toHaveBeenCalledOnce()
        expect(requestApproval).toHaveBeenCalledOnce()
        expect(recordDecision).toHaveBeenCalledWith('fp-1', 'deny')
        expect(onApprovalResponse).toHaveBeenCalledWith({ fingerprint: 'fp-1', decision: 'deny' })
        expect(markDenied).toHaveBeenCalledOnce()
        expect(execute).not.toHaveBeenCalled()
    })

    test('records granted approvals and skips the check on subsequent calls', async () => {
        const recordDecision = vi.fn()
        let checkCalls = 0
        const approvalManager: ApprovalManager = {
            isDangerousMode: false,
            getRiskLevel: () => 'execute',
            check: () => {
                checkCalls += 1
                if (checkCalls === 1) {
                    return {
                        needApproval: true as const,
                        fingerprint: 'fp-2',
                        riskLevel: 'execute' as const,
                        reason: 'risky',
                        toolName: 'echo',
                        params: {},
                    }
                }
                return { needApproval: false as const, decision: 'auto-execute' as const }
            },
            recordDecision,
            isGranted: () => checkCalls > 1,
            clearOnceApprovals: () => {},
            dispose: () => {},
        }
        const ctx = makeCtx({
            approvalManager,
            approvalHooks: { requestApproval: async () => 'once' as const },
        })

        await runWrapped({ echo: makeEcho() }, 'echo', {}, ctx)
        await runWrapped({ echo: makeEcho() }, 'echo', {}, ctx)

        expect(checkCalls).toBe(2)
        expect(recordDecision).toHaveBeenCalledWith('fp-2', 'once')
    })

    test('acquires the gate exclusively for mutating tools', async () => {
        const acquire = vi.fn(async () => ({ skipped: false, release: () => {} }))
        const ctx = makeCtx({ gate: { acquire, markDenied: () => {} } })
        const mutating = tool({
            description: 'write',
            inputSchema: jsonSchema({ type: 'object' }),
            metadata: { memo: { isMutating: true } },
            execute: async () => ({ type: 'text', value: 'written' }),
        })
        await runWrapped({ write: mutating }, 'write', {}, ctx)
        expect(acquire).toHaveBeenCalledWith(true)
    })

    test('acquires the gate shared for read-only parallel tools', async () => {
        const acquire = vi.fn(async () => ({ skipped: false, release: () => {} }))
        const ctx = makeCtx({ gate: { acquire, markDenied: () => {} } })
        await runWrapped({ echo: makeEcho() }, 'echo', {}, ctx)
        expect(acquire).toHaveBeenCalledWith(false)
    })

    test('skips with a text notice when the gate rejects (previous denial in step)', async () => {
        const execute = vi.fn(async () => ({ type: 'text', value: 'must not run' }))
        const ctx = makeCtx({
            gate: { acquire: async () => ({ skipped: true }), markDenied: () => {} },
        })
        const output = await runWrapped({ echo: makeEcho(execute) }, 'echo', {}, ctx)
        expect(output).toEqual({ type: 'text', value: TOOL_SKIPPED_AFTER_REJECTION_MESSAGE })
        expect(execute).not.toHaveBeenCalled()
    })

    test('truncates oversized text output into a system_hint', async () => {
        process.env.MEMO_TOOL_RESULT_MAX_CHARS = '10'
        const execute = async () => ({ type: 'text', value: 'x'.repeat(100) })
        const output = await runWrapped({ echo: makeEcho(execute) }, 'echo', {}, makeCtx())
        expect(output?.type).toBe('text')
        expect((output as { value: string }).value).toContain('system_hint')
        expect((output as { value: string }).value).toContain('tool_output_omitted')
    })

    test('wraps execute errors into error-text', async () => {
        const execute = async () => {
            throw new Error('boom')
        }
        const output = await runWrapped({ echo: makeEcho(execute) }, 'echo', {}, makeCtx())
        expect(output).toEqual({ type: 'error-text', value: 'Tool execution failed: boom' })
    })

    test('rethrows when the abort signal is aborted', async () => {
        const controller = new AbortController()
        controller.abort()
        const execute = async () => {
            throw new Error('aborted upstream')
        }
        const wrapped = wrapToolSetWithRuntime({ echo: makeEcho(execute) })
        const options = {
            experimental_context: makeCtx(),
            abortSignal: controller.signal,
        } as unknown as ToolExecutionOptions
        await expect(wrapped?.echo?.execute?.({}, options)).rejects.toThrow('aborted upstream')
    })

    test('passes through tools without an execute function untouched', () => {
        const providerTool = { type: 'provider' as const, id: 'mock.echo', args: {} }
        const wrapped = wrapToolSetWithRuntime({ provider: providerTool as unknown as Tool })
        expect(wrapped?.provider).toBe(providerTool)
    })
})
