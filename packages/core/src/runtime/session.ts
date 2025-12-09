/**
 * Session/Turn 运行时：负责多轮对话状态、工具调度、日志事件写入与 token 统计。
 */
import { randomUUID } from 'node:crypto'
import { createHistoryEvent } from '@memo/core/runtime/history'
import { withDefaultDeps } from '@memo/core/runtime/defaults'
import { parseAssistant } from '@memo/core/utils/utils'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types'
import type {
    AgentSession,
    AgentSessionDeps,
    AgentSessionOptions,
    AgentStepTrace,
    ChatMessage,
    HistoryEvent,
    HistorySink,
    LLMResponse,
    ParsedAssistant,
    SessionMode,
    TokenCounter,
    TokenUsage,
    TurnResult,
    TurnStatus,
} from '@memo/core/types'
import type { ToolRegistry } from '@memo/core/types'

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

function normalizeLLMResponse(raw: LLMResponse): { content: string; usage?: Partial<TokenUsage> } {
    if (typeof raw === 'string') {
        return { content: raw }
    }
    return { content: raw.content, usage: raw.usage }
}

async function emitEventToSinks(event: HistoryEvent, sinks: HistorySink[]) {
    for (const sink of sinks) {
        try {
            await sink.append(event)
        } catch (err) {
            console.error(`写入历史事件失败: ${(err as Error).message}`)
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
        const message = issue?.message || '参数不合法'
        return { ok: false as const, error: `${tool.name} 参数不合法: ${path} ${message}` }
    }
    return { ok: true as const, data: parsed.data }
}

/** 进程内的对话 Session，实现多轮运行与日志写入。 */
class AgentSessionImpl implements AgentSession {
    public id: string
    public mode: SessionMode
    public history: ChatMessage[]

    private turnIndex = 0
    private tokenCounter: TokenCounter
    private sinks: HistorySink[]
    private sessionUsage: TokenUsage = emptyUsage()
    private startedAt = Date.now()
    private maxSteps: number

    constructor(
        private deps: AgentSessionDeps & {
            tools: ToolRegistry
            callLLM: NonNullable<AgentSessionDeps['callLLM']>
        },
        private options: AgentSessionOptions,
        systemPrompt: string,
        tokenCounter: TokenCounter,
        maxSteps: number,
    ) {
        this.id = options.sessionId || randomUUID()
        this.mode = options.mode || DEFAULT_SESSION_MODE
        this.history = [{ role: 'system', content: systemPrompt }]
        this.tokenCounter = tokenCounter
        this.sinks = deps.historySinks ?? []
        this.maxSteps = maxSteps
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
        this.turnIndex += 1
        const turn = this.turnIndex
        const steps: AgentStepTrace[] = []
        const turnUsage = emptyUsage()
        const turnStartedAt = Date.now()

        // 写入用户消息
        this.history.push({ role: 'user', content: input })

        const promptTokens = this.tokenCounter.countMessages(this.history)
        await this.emitEvent('turn_start', {
            turn,
            content: input,
            meta: { tokens: { prompt: promptTokens } },
        })

        // 提示词超过硬上限时直接返回提示，避免无意义请求。
        if (this.options.maxPromptTokens && promptTokens > this.options.maxPromptTokens) {
            const limitMessage = `上下文 tokens (${promptTokens}) 超出限制，请缩短输入或重启对话。`
            const finalPayload = JSON.stringify({ final: limitMessage })
            this.history.push({ role: 'assistant', content: finalPayload })
            await this.emitEvent('final', {
                turn,
                content: limitMessage,
                role: 'assistant',
                meta: { tokens: { prompt: promptTokens } },
            })
            await this.emitEvent('turn_end', {
                turn,
                meta: {
                    status: 'prompt_limit',
                    durationMs: Date.now() - turnStartedAt,
                    tokens: turnUsage,
                },
            })
            return {
                finalText: limitMessage,
                steps,
                status: 'prompt_limit',
                errorMessage: limitMessage,
                tokenUsage: turnUsage,
            }
        }

        let finalText = ''
        let status: TurnStatus = 'ok'

        // ReAct 主循环，受 MAX_STEPS 保护。
        for (let step = 0; step < this.maxSteps; step++) {
            const estimatedPrompt = this.tokenCounter.countMessages(this.history)
            if (this.options.warnPromptTokens && estimatedPrompt > this.options.warnPromptTokens) {
                console.warn(`提示 tokens 已接近上限: ${estimatedPrompt}`)
            }

            let assistantText = ''
            let usageFromLLM: Partial<TokenUsage> | undefined
            try {
                const llmResult = await this.deps.callLLM(this.history)
                const normalized = normalizeLLMResponse(llmResult)
                assistantText = normalized.content
                usageFromLLM = normalized.usage
            } catch (err) {
                const msg = `LLM 调用失败: ${(err as Error).message}`
                const finalPayload = JSON.stringify({ final: msg })
                this.history.push({ role: 'assistant', content: finalPayload })
                status = 'error'
                finalText = msg
                await this.emitEvent('final', { turn, content: msg, role: 'assistant' })
                break
            }

            this.deps.onAssistantStep?.(assistantText, step)
            this.history.push({ role: 'assistant', content: assistantText })

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

            const parsed: ParsedAssistant = parseAssistant(assistantText)
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
                break
            }

            if (parsed.action) {
                await this.emitEvent('action', {
                    turn,
                    step,
                    meta: { tool: parsed.action.tool, input: parsed.action.input },
                })

                const tool = this.deps.tools[parsed.action.tool]
                let observation: string
                let toolFailed = false
                try {
                    if (tool) {
                        const parsedInput = parseToolInput(tool, parsed.action.input)
                        if (!parsedInput.ok) {
                            observation = parsedInput.error
                        } else {
                            const result = await tool.execute(parsedInput.data)
                            observation = flattenCallToolResult(result) || '(工具无输出)'
                            toolFailed = Boolean(result.isError)
                        }
                    } else {
                        observation = `未知工具: ${parsed.action.tool}`
                    }
                } catch (err) {
                    observation = `工具执行失败: ${(err as Error).message}`
                    toolFailed = true
                }

                this.history.push({
                    role: 'user',
                    content: JSON.stringify({ observation, tool: parsed.action.tool }),
                })
                const lastStep = steps[steps.length - 1]
                if (lastStep) {
                    lastStep.observation = observation
                }
                this.deps.onObservation?.(parsed.action.tool, observation, step)

                await this.emitEvent('observation', {
                    turn,
                    step,
                    content: observation,
                    meta: { tool: parsed.action.tool },
                })

                if (toolFailed) {
                    status = 'error'
                    finalText = observation
                    await this.emitEvent('final', {
                        turn,
                        step,
                        content: observation,
                        role: 'assistant',
                        meta: { tokens: stepUsage },
                    })
                    break
                }
                continue
            }

            // 无 action/final，跳出并兜底
            break
        }

        if (!finalText) {
            status = status === 'error' ? status : 'max_steps'
            finalText = '未能生成最终回答，请重试或调整问题。'
            const payload = JSON.stringify({ final: finalText })
            this.history.push({ role: 'assistant', content: payload })
            await this.emitEvent('final', {
                turn,
                content: finalText,
                role: 'assistant',
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
            tokenUsage: turnUsage,
        }
    }

    async close() {
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
                    console.error(`历史 flush 失败: ${(err as Error).message}`)
                }
            }
        }
        this.tokenCounter.dispose()
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
    )
    await session.init()
    return session
}
