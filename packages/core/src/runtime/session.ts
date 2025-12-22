/** @file Session/Turn 运行时核心：负责 ReAct 循环、工具调度与事件记录。 */
import { randomUUID } from 'node:crypto'
import { createHistoryEvent } from '@memo/core/runtime/history'
import { withDefaultDeps } from '@memo/core/runtime/defaults'
import { parseAssistant } from '@memo/core/utils/utils'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types'
import type {
    ChatMessage,
    AgentSession,
    AgentSessionDeps,
    AgentSessionOptions,
    AgentStepTrace,
    HistoryEvent,
    HistorySink,
    LLMResponse,
    ParsedAssistant,
    SessionMode,
    TokenCounter,
    TokenUsage,
    ToolRegistry,
    TurnResult,
    TurnStatus,
} from '@memo/core/types'
import {
    buildHookRunners,
    runHook,
    snapshotHistory,
    type HookRunnerMap,
} from '@memo/core/runtime/hooks'

const DEFAULT_SESSION_MODE: SessionMode = 'interactive'

function emptyUsage(): TokenUsage {
    return { prompt: 0, completion: 0, total: 0 }
}

function accumulateUsage(target: TokenUsage, delta?: Partial<TokenUsage>) {
    if (!delta) return
    const promptDelta = delta.prompt ?? 0
    const completionDelta = delta.completion ?? 0
    const totalDelta = delta.total ?? promptDelta + completionDelta
    target.prompt += promptDelta
    target.completion += completionDelta
    target.total += totalDelta
}

function normalizeLLMResponse(raw: LLMResponse): {
    content: string
    usage?: Partial<TokenUsage>
    streamed?: boolean
} {
    if (typeof raw === 'string') {
        return { content: raw }
    }
    return { content: raw.content, usage: raw.usage, streamed: raw.streamed }
}

async function emitEventToSinks(event: HistoryEvent, sinks: HistorySink[]) {
    for (const sink of sinks) {
        try {
            await sink.append(event)
        } catch (err) {
            console.error(`Failed to write history event: ${(err as Error).message}`)
        }
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

function parseToolInput(tool: ToolRegistry[string], rawInput: unknown) {
    let candidate: unknown = rawInput
    if (typeof rawInput === 'string') {
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
    const parsed = tool.inputSchema.safeParse(candidate)
    if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const path = issue?.path?.join('.') || 'input'
        const message = issue?.message || 'Invalid input'
        return { ok: false as const, error: `${tool.name} invalid input: ${path} ${message}` }
    }
    return { ok: true as const, data: parsed.data }
}

function isAbortError(err: unknown): err is Error {
    return err instanceof Error && err.name === 'AbortError'
}

/** 进程内的对话 Session，实现多轮运行与日志写入。 */
class AgentSessionImpl implements AgentSession {
    public id: string
    public mode: SessionMode
    public history: ChatMessage[]
    public historyFilePath?: string

    private turnIndex = 0
    private tokenCounter: TokenCounter
    private sinks: HistorySink[]
    private sessionUsage: TokenUsage = emptyUsage()
    private startedAt = Date.now()
    private maxSteps: number
    private hooks: HookRunnerMap
    private closed = false
    private currentAbortController: AbortController | null = null
    private cancelling = false

    constructor(
        private deps: AgentSessionDeps & {
            tools: ToolRegistry
            callLLM: NonNullable<AgentSessionDeps['callLLM']>
        },
        private options: AgentSessionOptions,
        systemPrompt: string,
        tokenCounter: TokenCounter,
        maxSteps: number,
        historyFilePath?: string,
    ) {
        this.id = options.sessionId || randomUUID()
        this.mode = options.mode || DEFAULT_SESSION_MODE
        this.history = [{ role: 'system', content: systemPrompt }]
        this.tokenCounter = tokenCounter
        this.sinks = deps.historySinks ?? []
        this.maxSteps = maxSteps
        this.hooks = buildHookRunners(deps)
        this.historyFilePath = historyFilePath
    }

    /** 写入 Session 启动事件，记录配置与 token 限制。 */
    async init() {
        await this.emitEvent('session_start', {
            meta: {
                mode: this.mode,
                tokenizer: this.tokenCounter.model,
                warnPromptTokens: this.options.warnPromptTokens,
                maxPromptTokens: this.options.maxPromptTokens,
            },
        })
    }

    /** 执行一次 Turn：接受用户输入，走 ReAct 循环，返回最终结果与步骤轨迹。 */
    async runTurn(input: string): Promise<TurnResult> {
        const abortController = new AbortController()
        this.currentAbortController = abortController
        this.cancelling = false
        this.turnIndex += 1
        const turn = this.turnIndex
        const steps: AgentStepTrace[] = []
        const turnUsage = emptyUsage()
        const turnStartedAt = Date.now()

        // 写入用户消息
        this.history.push({ role: 'user', content: input })

        try {
            const promptTokens = this.tokenCounter.countMessages(this.history)
            await this.emitEvent('turn_start', {
                turn,
                content: input,
                meta: { tokens: { prompt: promptTokens } },
            })
            await runHook(this.hooks, 'onTurnStart', {
                sessionId: this.id,
                turn,
                input,
                history: snapshotHistory(this.history),
            })

            let finalText = ''
            let status: TurnStatus = 'ok'
            let errorMessage: string | undefined

            // ReAct 主循环，受 MAX_STEPS 保护。
            for (let step = 0; step < this.maxSteps; step++) {
            const estimatedPrompt = this.tokenCounter.countMessages(this.history)
            if (this.options.maxPromptTokens && estimatedPrompt > this.options.maxPromptTokens) {
                const limitMessage = `Context tokens (${estimatedPrompt}) exceed the limit. Please shorten the input or restart the session.`
                const finalPayload = JSON.stringify({ final: limitMessage })
                this.history.push({ role: 'assistant', content: finalPayload })
                status = 'prompt_limit'
                finalText = limitMessage
                errorMessage = limitMessage
                await this.emitEvent('final', {
                    turn,
                    step,
                    content: limitMessage,
                    role: 'assistant',
                    meta: { tokens: { prompt: estimatedPrompt } },
                })
                await runHook(this.hooks, 'onFinal', {
                    sessionId: this.id,
                    turn,
                    step,
                    finalText: limitMessage,
                    status,
                    errorMessage,
                    turnUsage: { ...turnUsage },
                    steps,
                })
                break
            }
            if (this.options.warnPromptTokens && estimatedPrompt > this.options.warnPromptTokens) {
                console.warn(`Prompt tokens are near the limit: ${estimatedPrompt}`)
            }

            let assistantText = ''
            let usageFromLLM: Partial<TokenUsage> | undefined
            let streamed = false
            try {
                const llmResult = await this.deps.callLLM(
                    this.history,
                    (chunk) => this.deps.onAssistantStep?.(chunk, step),
                    { signal: abortController.signal },
                )
                const normalized = normalizeLLMResponse(llmResult)
                assistantText = normalized.content
                usageFromLLM = normalized.usage
                streamed = Boolean(normalized.streamed)
            } catch (err) {
                if (this.cancelling && isAbortError(err)) {
                    status = 'cancelled'
                    finalText = ''
                    errorMessage = 'Turn cancelled'
                    await this.emitEvent('final', {
                        turn,
                        step,
                        content: '',
                        role: 'assistant',
                        meta: { cancelled: true },
                    })
                    await runHook(this.hooks, 'onFinal', {
                        sessionId: this.id,
                        turn,
                        step,
                        finalText,
                        status,
                        errorMessage,
                        turnUsage: { ...turnUsage },
                        steps,
                    })
                    break
                }
                const msg = `LLM call failed: ${(err as Error).message}`
                const finalPayload = JSON.stringify({ final: msg })
                this.history.push({ role: 'assistant', content: finalPayload })
                status = 'error'
                finalText = msg
                errorMessage = msg
                await this.emitEvent('final', { turn, content: msg, role: 'assistant' })
                await runHook(this.hooks, 'onFinal', {
                    sessionId: this.id,
                    turn,
                    step,
                    finalText,
                    status,
                    errorMessage,
                    turnUsage: { ...turnUsage },
                    steps,
                })
                break
            }

            if (!streamed) {
                this.deps.onAssistantStep?.(assistantText, step)
            }

            const parsed: ParsedAssistant = parseAssistant(assistantText)
            const historyContent = parsed.action
                ? JSON.stringify({
                      tool: parsed.action.tool,
                      input: parsed.action.input,
                  })
                : assistantText
            this.history.push({ role: 'assistant', content: historyContent })

            // 将本地 tokenizer 与 LLM usage（若有）结合，记录 step 级 token 数据。
            const completionTokens = this.tokenCounter.countText(assistantText)
            const promptUsed = usageFromLLM?.prompt ?? estimatedPrompt
            const completionUsed = usageFromLLM?.completion ?? completionTokens
            const totalUsed = usageFromLLM?.total ?? promptUsed + completionUsed
            const stepUsage: TokenUsage = {
                prompt: promptUsed,
                completion: completionUsed,
                total: totalUsed,
            }
            accumulateUsage(turnUsage, stepUsage)
            accumulateUsage(this.sessionUsage, stepUsage)

            steps.push({
                index: step,
                assistantText,
                parsed,
                tokenUsage: stepUsage,
            })

            await this.emitEvent('assistant', {
                turn,
                step,
                content: assistantText,
                role: 'assistant',
                meta: { tokens: stepUsage },
            })

            if (parsed.final) {
                finalText = parsed.final
                await this.emitEvent('final', {
                    turn,
                    step,
                    content: parsed.final,
                    role: 'assistant',
                    meta: { tokens: stepUsage },
                })
                await runHook(this.hooks, 'onFinal', {
                    sessionId: this.id,
                    turn,
                    step,
                    finalText,
                    status,
                    tokenUsage: stepUsage,
                    turnUsage: { ...turnUsage },
                    steps,
                })
                break
            }

            if (parsed.action) {
                await this.emitEvent('action', {
                    turn,
                    step,
                    meta: { tool: parsed.action.tool, input: parsed.action.input },
                })
                await runHook(this.hooks, 'onAction', {
                    sessionId: this.id,
                    turn,
                    step,
                    action: parsed.action,
                    history: snapshotHistory(this.history),
                })

                const tool = this.deps.tools[parsed.action.tool]
                let observation: string
                try {
                    if (tool) {
                        const parsedInput = parseToolInput(tool, parsed.action.input)
                        if (!parsedInput.ok) {
                            observation = parsedInput.error
                        } else {
                            const result = await tool.execute(parsedInput.data)
                            observation = flattenCallToolResult(result) || '(no tool output)'
                        }
                    } else {
                        observation = `Unknown tool: ${parsed.action.tool}`
                    }
                } catch (err) {
                    observation = `Tool execution failed: ${(err as Error).message}`
                }

                this.history.push({
                    role: 'user',
                    content: JSON.stringify({ observation, tool: parsed.action.tool }),
                })
                const lastStep = steps[steps.length - 1]
                if (lastStep) {
                    lastStep.observation = observation
                }
                await this.emitEvent('observation', {
                    turn,
                    step,
                    content: observation,
                    meta: { tool: parsed.action.tool },
                })
                await runHook(this.hooks, 'onObservation', {
                    sessionId: this.id,
                    turn,
                    step,
                    tool: parsed.action.tool,
                    observation,
                    history: snapshotHistory(this.history),
                })
                continue
            }

            // 无 action/final，跳出并兜底
            break
        }

        if (!finalText && status !== 'cancelled') {
            if (status === 'ok') {
                status = steps.length >= this.maxSteps ? 'max_steps' : 'error'
            }
            finalText = 'Unable to produce a final answer. Please retry or adjust the request.'
            errorMessage = finalText
            const payload = JSON.stringify({ final: finalText })
            this.history.push({ role: 'assistant', content: payload })
            await this.emitEvent('final', {
                turn,
                content: finalText,
                role: 'assistant',
            })
            await runHook(this.hooks, 'onFinal', {
                sessionId: this.id,
                turn,
                finalText,
                status,
                errorMessage,
                turnUsage: { ...turnUsage },
                steps,
            })
        }

            await this.emitEvent('turn_end', {
                turn,
                meta: {
                    status,
                    stepCount: steps.length,
                    durationMs: Date.now() - turnStartedAt,
                    tokens: turnUsage,
                },
            })

            return {
                finalText,
                steps,
                status,
                errorMessage,
                tokenUsage: turnUsage,
            }
        } finally {
            this.currentAbortController = null
            this.cancelling = false
        }
    }

    cancelCurrentTurn() {
        if (this.currentAbortController) {
            this.cancelling = true
            this.currentAbortController.abort()
        }
    }

    async close() {
        if (this.closed) return
        this.closed = true
        await this.emitEvent('session_end', {
            meta: {
                durationMs: Date.now() - this.startedAt,
                tokens: this.sessionUsage,
            },
        })
        for (const sink of this.sinks) {
            if (sink.flush) {
                try {
                    await sink.flush()
                } catch (err) {
                    console.error(`History flush failed: ${(err as Error).message}`)
                }
            }
        }
        this.tokenCounter.dispose()
        if (this.deps.dispose) {
            await this.deps.dispose()
        }
    }

    /** 将结构化事件发送到所有历史 sink，独立于主流程错误。 */
    private async emitEvent(
        type: HistoryEvent['type'],
        payload: Omit<HistoryEvent, 'ts' | 'sessionId' | 'type'>,
    ) {
        if (!this.sinks.length) return
        const event = createHistoryEvent({
            sessionId: this.id,
            type,
            turn: payload.turn,
            step: payload.step,
            content: payload.content,
            role: payload.role,
            meta: payload.meta,
        })
        await emitEventToSinks(event, this.sinks)
    }
}

/**
 * 创建一个 Agent Session，支持多轮对话与 JSONL 事件记录。
 */
export async function createAgentSession(
    deps: AgentSessionDeps,
    options: AgentSessionOptions = {},
): Promise<AgentSession> {
    const sessionId = options.sessionId || randomUUID()
    const resolved = await withDefaultDeps(deps, { ...options, sessionId }, sessionId)
    const systemPrompt = await resolved.loadPrompt()
    const session = new AgentSessionImpl(
        { ...(deps as AgentSessionDeps), ...resolved },
        { ...options, sessionId, mode: options.mode ?? DEFAULT_SESSION_MODE },
        systemPrompt,
        resolved.tokenCounter,
        resolved.maxSteps,
        resolved.historyFilePath,
    )
    await session.init()
    return session
}
