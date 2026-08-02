import { describe, expect, test } from 'vitest'
import type { Tool, ToolExecutionOptions } from 'ai'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import { createAgentSession, createTokenCounter, type CallLLM, type AgentSessionDeps, type LLMResult } from '@memo/core'
import type { ToolExecutionContext } from '@memo/core/tools/sdk_tools'
import { emptyUsage } from '@memo/core/utils/usage'
import {
    followupTaskTool,
    interruptAgentTool,
    listAgentsTool,
    sendMessageTool,
    spawnAgentTool,
    waitAgentTool,
} from './collab'

function response(text: string): LLMResult {
    return {
        text,
        toolCalls: [],
        toolResults: [],
        usage: emptyUsage(),
        finishReason: 'stop',
    }
}

function textPayload(result: ToolResultOutput): string {
    return result.type === 'text' || result.type === 'error-text' ? result.value : ''
}

function toolOptions(context: ToolExecutionContext): ToolExecutionOptions {
    return { experimental_context: context } as ToolExecutionOptions
}

async function runTool(tool: Tool, input: unknown, context: ToolExecutionContext): Promise<ToolResultOutput> {
    return (await tool.execute!(input, toolOptions(context))) as ToolResultOutput
}

async function createHarness(callLLM?: CallLLM, overrides: Partial<AgentSessionDeps> = {}) {
    let rootContext: ToolExecutionContext | undefined
    const calls: Array<{ path?: string; content: string }> = []
    const session = await createAgentSession({
        ...overrides,
        callLLM: async (messages, _onChunk, options) => {
            const path = options?.toolContext?.collab?.agentPath
            if (path === '/root') rootContext = options?.toolContext
            const last = messages[messages.length - 1]
            const content = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '')
            if (path) calls.push({ path, content })
            return callLLM ? callLLM(messages, _onChunk, options) : response(`done:${content}`)
        },
        historySinks: [],
        loadPrompt: async () => 'system',
        tokenCounter: createTokenCounter(),
        tools: {},
    })
    await session.runTurn('bootstrap')
    if (!rootContext) throw new Error('root tool context was not captured')
    return { session, context: rootContext, calls }
}

describe('in-process collab tools', () => {
    test('spawns a stateful child and delivers completion through the parent mailbox', async () => {
        const harness = await createHarness()
        try {
            const spawnedResult = await runTool(
                spawnAgentTool,
                { task_name: 'review', message: 'inspect this', fork_turns: 'all' },
                harness.context,
            )
            const spawned = JSON.parse(textPayload(spawnedResult))
            expect(spawned.agent_path).toBe('/root/review')

            const waitResult = await runTool(waitAgentTool, { timeout_ms: 10_000 }, harness.context)
            expect(JSON.parse(textPayload(waitResult))).toMatchObject({ timed_out: false })

            const agentsResult = await runTool(listAgentsTool, {}, harness.context)
            const agents = JSON.parse(textPayload(agentsResult)).agents
            expect(agents).toHaveLength(1)
            expect(agents[0]).toMatchObject({ agent_path: '/root/review', status: 'completed' })
            expect(harness.context.collab?.inputQueue.drainAll()[0]?.content).toContain('agent_completion')
        } finally {
            await harness.session.close()
        }
    })

    test('queues messages without waking idle agents and folds them into a later follow-up', async () => {
        const harness = await createHarness()
        try {
            await runTool(spawnAgentTool, { task_name: 'worker', message: 'first' }, harness.context)
            await runTool(waitAgentTool, { timeout_ms: 10_000 }, harness.context)
            harness.context.collab?.inputQueue.drainAll()

            await runTool(sendMessageTool, { target: 'worker', message: 'queued note' }, harness.context)
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(harness.calls.filter((call) => call.path === '/root/worker')).toHaveLength(1)

            await runTool(followupTaskTool, { target: 'worker', message: 'continue now' }, harness.context)
            await runTool(waitAgentTool, { timeout_ms: 10_000 }, harness.context)
            const childCalls = harness.calls.filter((call) => call.path === '/root/worker')
            expect(childCalls).toHaveLength(2)
            expect(childCalls[1]?.content).toContain('queued note')
            expect(childCalls[1]?.content).toContain('continue now')
        } finally {
            await harness.session.close()
        }
    })

    test('rejects a second running child when the execution limit is reached', async () => {
        const previous = process.env.MEMO_SUBAGENT_MAX_AGENTS
        process.env.MEMO_SUBAGENT_MAX_AGENTS = '1'
        let releaseChild!: () => void
        const childBlocked = new Promise<void>((resolve) => {
            releaseChild = resolve
        })
        const harness = await createHarness(async (_messages, _onChunk, options) => {
            if (options?.toolContext?.collab?.agentPath !== '/root') await childBlocked
            return response('done')
        })
        try {
            await runTool(spawnAgentTool, { task_name: 'first', message: 'hold' }, harness.context)
            const second = await runTool(spawnAgentTool, { task_name: 'second', message: 'blocked' }, harness.context)
            expect(second.type).toBe('error-text')
            expect(textPayload(second)).toContain('concurrency limit')
            releaseChild()
            await runTool(waitAgentTool, { timeout_ms: 10_000 }, harness.context)
        } finally {
            releaseChild()
            await harness.session.close()
            if (previous === undefined) delete process.env.MEMO_SUBAGENT_MAX_AGENTS
            else process.env.MEMO_SUBAGENT_MAX_AGENTS = previous
        }
    })

    test('injects a running follow-up before the child turn can finish', async () => {
        let childCalls = 0
        let markStarted!: () => void
        let releaseFirst!: () => void
        const started = new Promise<void>((resolve) => {
            markStarted = resolve
        })
        const blocked = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })
        const harness = await createHarness(async (_messages, _onChunk, options) => {
            if (options?.toolContext?.collab?.agentPath === '/root/live') {
                childCalls += 1
                if (childCalls === 1) {
                    markStarted()
                    await blocked
                }
            }
            return response(`child-call-${childCalls}`)
        })
        try {
            await runTool(spawnAgentTool, { task_name: 'live', message: 'start' }, harness.context)
            await started
            await runTool(followupTaskTool, { target: 'live', message: 'new requirement' }, harness.context)
            releaseFirst()
            await runTool(waitAgentTool, { timeout_ms: 10_000 }, harness.context)
            expect(childCalls).toBe(2)
            const calls = harness.calls.filter((call) => call.path === '/root/live')
            expect(calls[1]?.content).toContain('new requirement')
        } finally {
            releaseFirst()
            await harness.session.close()
        }
    })

    test('interrupts a turn and resumes the same child session with follow-up work', async () => {
        let childCalls = 0
        let markStarted!: () => void
        const started = new Promise<void>((resolve) => {
            markStarted = resolve
        })
        const harness = await createHarness(async (_messages, _onChunk, options) => {
            if (options?.toolContext?.collab?.agentPath !== '/root/recover') return response('root')
            childCalls += 1
            if (childCalls > 1) return response('recovered')
            markStarted()
            return new Promise<LLMResult>((_resolve, reject) => {
                options?.signal?.addEventListener(
                    'abort',
                    () => {
                        const error = new Error('operation was aborted')
                        error.name = 'AbortError'
                        reject(error)
                    },
                    { once: true },
                )
            })
        })
        try {
            await runTool(spawnAgentTool, { task_name: 'recover', message: 'hang' }, harness.context)
            await started
            const interrupted = await runTool(interruptAgentTool, { target: 'recover' }, harness.context)
            expect(JSON.parse(textPayload(interrupted)).previous_status).toBe('running')
            await runTool(followupTaskTool, { target: 'recover', message: 'try again' }, harness.context)
            await runTool(waitAgentTool, { timeout_ms: 10_000 }, harness.context)
            expect(childCalls).toBe(2)
        } finally {
            await harness.session.close()
        }
    })

    test('keeps the shared dependency disposer owned by the root session', async () => {
        let disposeCalls = 0
        const harness = await createHarness(undefined, {
            dispose: async () => {
                disposeCalls += 1
            },
        })
        await runTool(spawnAgentTool, { task_name: 'owned', message: 'finish' }, harness.context)
        await runTool(waitAgentTool, { timeout_ms: 10_000 }, harness.context)
        expect(disposeCalls).toBe(0)
        await harness.session.close()
        expect(disposeCalls).toBe(1)
    })
})
