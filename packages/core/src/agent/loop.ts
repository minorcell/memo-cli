/** @file Session/Turn runtime core: handles ReAct loop, tool scheduling, and event logging. */
import { randomUUID } from 'node:crypto'
import {
    buildCompactionUserPrompt,
    CONTEXT_COMPACTION_SYSTEM_PROMPT,
    CONTEXT_SUMMARY_PREFIX,
    isContextSummaryMessage,
} from '@memo/core/agent/compact_prompt'
import type {
    ChatMessage,
    AgentSession,
    AgentSessionDeps,
    AgentSessionOptions,
    AgentStepTrace,
    CompactReason,
    CompactResult,
    HistoryEvent,
    HistorySink,
    ParsedAssistant,
    Role,
    SessionMode,
    ToolPermissionMode,
    TokenCounter,
    ToolRegistry,
    TurnResult,
    TurnStatus,
} from '@memo/core/types'
import type { LanguageModelUsage, ToolCallPart, ToolResultPart } from 'ai'
import { buildHookRunners, runHook, snapshotHistory, type HookRunnerMap } from '@memo/core/agent/hooks'
import {
    DEFAULT_CONTEXT_WINDOW,
    DEFAULT_SESSION_MODE,
    TOOL_ACTION_SUCCESS_STATUS,
    TOOL_DISABLED_ERROR_MESSAGE,
} from '@memo/core/agent/constants'
import { accumulateUsage, emptyUsage } from '@memo/core/utils/usage'
import { isAbortError } from '@memo/core/utils/errors'
import { stableStringify } from '@memo/core/utils/serialize'
import { fallbackSessionTitleFromPrompt } from '@memo/core/utils/title'
import { createApprovalManager, type ApprovalManager } from '@memo/core/tools/approval'
import type { ToolApprovalHooks } from '@memo/core/tools/orchestrator'
import { runWithRuntimeContext } from '@memo/core/tools/runtime/context'
import type { ToolExecutionContext } from '@memo/core/tools/sdk_tools'
import { createStepGate } from '@memo/core/tools/runtime/step_gate'
import {
    mapOutputStatus,
    normalizeLLMResponse,
    outputToObservation,
    parseTextToolCall,
    toToolHistoryMessage,
} from './messages'
import type { ApprovalRequest, ApprovalDecision } from '@memo/core/tools/approval'
import type { ToolActionStatus } from '@memo/core/tools/orchestrator'

const DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT = 80
const COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000

/** In-process conversation Session, implements multi-turn execution and log writing. */
export class AgentSessionImpl implements AgentSession {
    public title?: string
    public id: string
    public mode: SessionMode
    public history: ChatMessage[]
    public historyFilePath?: string

    private turnIndex = 0
    private tokenCounter: TokenCounter
    private sinks: HistorySink[]
    private sessionUsage: LanguageModelUsage = emptyUsage()
    private startedAt = Date.now()
    private hooks: HookRunnerMap
    private closed = false
    private sessionStartEmitted = false
    private currentAbortController: AbortController | null = null
    private cancelling = false
    private lastActionSignature: string | null = null
    private repeatedActionCount = 0
    private approvalManager: ApprovalManager
    private toolsDisabled = false
    private toolPermissionMode: ToolPermissionMode | 'auto' = 'auto'
    /** Thinking override; undefined follows the provider model profile. */
    private thinkingOverride: boolean | undefined

    constructor(
        private deps: AgentSessionDeps & {
            tools: ToolRegistry
            callLLM: NonNullable<AgentSessionDeps['callLLM']>
        },
        private options: AgentSessionOptions,
        systemPrompt: string,
        tokenCounter: TokenCounter,
        historyFilePath?: string,
    ) {
        this.id = options.sessionId || randomUUID()
        this.mode = options.mode || DEFAULT_SESSION_MODE
        this.history = [{ role: 'system', content: systemPrompt }]
        this.tokenCounter = tokenCounter
        this.sinks = deps.historySinks ?? []
        this.hooks = buildHookRunners(deps)
        this.historyFilePath = historyFilePath
        const resolvedPermission = resolveToolPermission(options)
        this.toolsDisabled = resolvedPermission.toolsDisabled
        this.toolPermissionMode = resolvedPermission.mode
        this.approvalManager = createApprovalManager({
            dangerous: resolvedPermission.dangerous,
            mode: resolvedPermission.approvalMode,
        })
        this.thinkingOverride = options.thinking
    }

    /** 运行时切换思考模式（undefined 恢复为跟随模型 profile）。 */
    setThinking(enabled: boolean): void {
        this.thinkingOverride = enabled
    }

    /** 初始化：延迟写入 session_start，避免空会话落盘。 */
    async init() {
        // 留空，等第一次 runTurn 时再写 session_start 事件
    }

    private resetActionRepetition() {
        this.lastActionSignature = null
        this.repeatedActionCount = 0
    }

    private maybeWarnRepeatedAction(tool: string, input: unknown) {
        const signature = `${tool}:${stableStringify(input)}`
        if (this.lastActionSignature === signature) {
            this.repeatedActionCount += 1
        } else {
            this.lastActionSignature = signature
            this.repeatedActionCount = 1
        }

        if (this.repeatedActionCount === 3) {
            const preview = stableStringify(input).slice(0, 200)
            const warning = `系统提醒：你已连续3次调用同一工具「${tool}」且参数相同（${preview}${
                preview.length >= 200 ? '…' : ''
            }）。请确认是否陷入循环，必要时直接给出最终回答或调整参数。`
            this.history.push({ role: 'system', content: warning })
        }
    }

    private resolveContextWindow(): number {
        const configured = this.options.contextWindow
        if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
            return Math.floor(configured)
        }
        return DEFAULT_CONTEXT_WINDOW
    }

    private resolveSessionCwd(): string {
        const cwd = this.options.cwd?.trim()
        if (cwd) return cwd
        return process.cwd()
    }

    private resolveAutoCompactThresholdPercent(): number {
        const configured = this.options.autoCompactThresholdPercent
        if (
            typeof configured === 'number' &&
            Number.isInteger(configured) &&
            Number.isFinite(configured) &&
            configured >= 1 &&
            configured <= 100
        ) {
            return configured
        }
        return DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT
    }

    private resolveThresholdTokens(contextWindow: number): number {
        const threshold = Math.floor((contextWindow * this.resolveAutoCompactThresholdPercent()) / 100)
        return Math.max(1, threshold)
    }

    private calculateUsagePercent(promptTokens: number, contextWindow: number): number {
        if (promptTokens <= 0 || contextWindow <= 0) return 0
        return Math.round((promptTokens / contextWindow) * 10_000) / 100
    }

    private async emitContextUsage(
        turn: number,
        step: number,
        promptTokens: number,
        contextWindow: number,
        thresholdTokens: number,
        phase: 'turn_start' | 'step_start' | 'post_compact',
    ) {
        const usagePercent = this.calculateUsagePercent(promptTokens, contextWindow)
        await this.emitEvent('context_usage', {
            turn,
            step,
            meta: {
                phase,
                prompt_tokens: promptTokens,
                context_window: contextWindow,
                threshold_tokens: thresholdTokens,
                usage_percent: usagePercent,
            },
        })
        await runHook(this.hooks, 'onContextUsage', {
            sessionId: this.id,
            turn,
            step,
            promptTokens,
            contextWindow,
            thresholdTokens,
            usagePercent,
            phase,
        })
    }

    private async emitContextCompacted(turn: number, step: number, result: CompactResult) {
        await this.emitEvent('context_compact', {
            turn,
            step,
            content: result.summary,
            meta: {
                reason: result.reason,
                status: result.status,
                before_tokens: result.beforeTokens,
                after_tokens: result.afterTokens,
                threshold_tokens: result.thresholdTokens,
                reduction_percent: result.reductionPercent,
                error_message: result.errorMessage,
            },
        })
        await runHook(this.hooks, 'onContextCompacted', {
            sessionId: this.id,
            turn,
            step,
            reason: result.reason,
            status: result.status,
            beforeTokens: result.beforeTokens,
            afterTokens: result.afterTokens,
            thresholdTokens: result.thresholdTokens,
            reductionPercent: result.reductionPercent,
            summary: result.summary,
            errorMessage: result.errorMessage,
        })
    }

    private buildCompactedHistory(summary: string): ChatMessage[] {
        const systemMessage = this.history[0]?.role === 'system' ? this.history[0] : undefined
        const historyWithoutSystem = systemMessage ? this.history.slice(1) : this.history
        const userMessages = historyWithoutSystem
            .filter(
                (message): message is ChatMessage & { role: 'user' } =>
                    message.role === 'user' && !isContextSummaryMessage(message),
            )
            .map((message) => (typeof message.content === 'string' ? message.content : ''))
        const retainedUserMessages = this.selectCompactionUserMessages(userMessages).map(
            (content) => ({ role: 'user', content }) as ChatMessage,
        )
        const summaryMessage: ChatMessage = {
            role: 'user',
            content: `${CONTEXT_SUMMARY_PREFIX}\n${summary}`,
        }

        if (systemMessage) {
            return [systemMessage, ...retainedUserMessages, summaryMessage]
        }
        return [...retainedUserMessages, summaryMessage]
    }

    private selectCompactionUserMessages(messages: string[]): string[] {
        if (!messages.length) {
            return []
        }

        const selected: string[] = []
        let remaining = COMPACT_USER_MESSAGE_MAX_TOKENS
        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const message = messages[i]
            if (!message) {
                continue
            }

            const tokens = this.tokenCounter.countText(message)
            if (tokens <= remaining) {
                selected.push(message)
                remaining = Math.max(0, remaining - tokens)
                if (remaining === 0) {
                    break
                }
                continue
            }

            if (remaining > 0) {
                // 4 chars ≈ 1 token (ASCII); CJK overshoots to ~3x the byte budget, which is acceptable for the compaction request.
                selected.push(message.slice(0, remaining * 4))
            }
            break
        }

        selected.reverse()
        return selected
    }

    private normalizeCompactionSummary(raw: string): string {
        const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
        const normalized = (withoutThink || raw).replace(/\n{3,}/g, '\n\n').trim()
        return normalized
    }

    private async compactHistoryInternal(reason: CompactReason, turn: number, step: number): Promise<CompactResult> {
        const contextWindow = this.resolveContextWindow()
        const thresholdTokens = this.resolveThresholdTokens(contextWindow)
        const beforeTokens = this.tokenCounter.countMessages(this.history)
        const systemMessage = this.history[0]?.role === 'system' ? this.history[0] : undefined
        const historyWithoutSystem = systemMessage ? this.history.slice(1) : this.history.slice()

        if (!historyWithoutSystem.length) {
            const skipped: CompactResult = {
                reason,
                status: 'skipped',
                beforeTokens,
                afterTokens: beforeTokens,
                thresholdTokens,
                reductionPercent: 0,
            }
            await this.emitContextCompacted(turn, step, skipped)
            return skipped
        }

        try {
            const response = await this.deps.callLLM(
                [
                    { role: 'system', content: CONTEXT_COMPACTION_SYSTEM_PROMPT },
                    { role: 'user', content: buildCompactionUserPrompt(historyWithoutSystem) },
                ],
                undefined,
                {},
            )
            const normalized = normalizeLLMResponse(response)
            const summary = this.normalizeCompactionSummary(normalized.textContent)
            if (!summary) {
                throw new Error('Compaction model returned an empty summary.')
            }

            const compactedHistory = this.buildCompactedHistory(summary)
            const afterTokens = this.tokenCounter.countMessages(compactedHistory)
            this.history.splice(0, this.history.length, ...compactedHistory)

            const reductionPercent =
                beforeTokens > 0
                    ? Math.max(0, Math.round(((beforeTokens - afterTokens) / beforeTokens) * 10_000) / 100)
                    : 0

            const result: CompactResult = {
                reason,
                status: 'success',
                beforeTokens,
                afterTokens,
                thresholdTokens,
                reductionPercent,
                summary,
            }
            await this.emitContextCompacted(turn, step, result)
            return result
        } catch (err) {
            const result: CompactResult = {
                reason,
                status: 'failed',
                beforeTokens,
                afterTokens: beforeTokens,
                thresholdTokens,
                reductionPercent: 0,
                errorMessage: (err as Error).message,
            }
            await this.emitContextCompacted(turn, step, result)
            return result
        }
    }

    private buildToolApprovalHooks(turn: number, step: number): ToolApprovalHooks {
        return {
            onApprovalRequest: async (request: ApprovalRequest) => {
                await runHook(this.hooks, 'onApprovalRequest', {
                    sessionId: this.id,
                    turn,
                    step,
                    request,
                })
            },
            requestApproval: async (request: ApprovalRequest): Promise<ApprovalDecision> => {
                if (this.deps.requestApproval) {
                    return this.deps.requestApproval(request)
                }
                return 'deny'
            },
            onApprovalResponse: async ({ fingerprint, decision }) => {
                await runHook(this.hooks, 'onApprovalResponse', {
                    sessionId: this.id,
                    turn,
                    step,
                    fingerprint,
                    decision,
                })
            },
        }
    }

    private async maybeGenerateSessionTitle(turn: number, originalPrompt: string) {
        if (turn !== 1 || this.title) return

        const title = fallbackSessionTitleFromPrompt(originalPrompt)
        this.title = title
        await this.emitEvent('session_title', {
            turn,
            content: title,
            meta: {
                source: 'first_prompt',
                original_prompt: originalPrompt,
            },
        })
        await runHook(this.hooks, 'onTitleGenerated', {
            sessionId: this.id,
            turn,
            title,
            originalPrompt,
        })
    }

    /** 执行一次 Turn：接受用户输入，走 ReAct 循环，返回最终结果与步骤轨迹。 */
    async runTurn(input: string): Promise<TurnResult> {
        return runWithRuntimeContext({ cwd: this.resolveSessionCwd() }, async () => {
            const abortController = new AbortController()
            this.currentAbortController = abortController
            this.cancelling = false
            this.turnIndex += 1
            const turn = this.turnIndex
            const steps: AgentStepTrace[] = []
            const turnUsage = emptyUsage()
            const turnStartedAt = Date.now()
            const contextWindow = this.resolveContextWindow()
            const thresholdTokens = this.resolveThresholdTokens(contextWindow)
            const autoCompactThresholdPercent = this.resolveAutoCompactThresholdPercent()
            let autoCompactedThisTurn = false

            if (!this.sessionStartEmitted) {
                const systemPrompt = this.history[0]?.role === 'system' ? this.history[0].content : undefined
                await this.emitEvent('session_start', {
                    content: systemPrompt,
                    role: systemPrompt ? 'system' : undefined,
                    meta: {
                        mode: this.mode,
                        cwd: this.resolveSessionCwd(),
                        warnPromptTokens: this.options.warnPromptTokens,
                        contextWindow,
                        autoCompactThresholdPercent,
                        toolPermissionMode: this.toolPermissionMode,
                    },
                })
                this.sessionStartEmitted = true
            }

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
                    promptTokens,
                    history: snapshotHistory(this.history),
                })
                await this.emitContextUsage(turn, 0, promptTokens, contextWindow, thresholdTokens, 'turn_start')
                await this.maybeGenerateSessionTitle(turn, input)

                let finalText = ''
                let status: TurnStatus = 'ok'
                let errorMessage: string | undefined
                let protocolViolationCount = 0
                let lastNonEmptyAssistantText: string | null = null
                let lastNonEmptyAssistantStep = -1

                // ReAct 主循环
                for (let step = 0; ; step++) {
                    let estimatedPrompt = this.tokenCounter.countMessages(this.history)
                    await this.emitContextUsage(
                        turn,
                        step,
                        estimatedPrompt,
                        contextWindow,
                        thresholdTokens,
                        'step_start',
                    )

                    if (!autoCompactedThisTurn && estimatedPrompt >= thresholdTokens) {
                        autoCompactedThisTurn = true
                        await this.compactHistoryInternal('auto', turn, step)
                        estimatedPrompt = this.tokenCounter.countMessages(this.history)
                        await this.emitContextUsage(
                            turn,
                            step,
                            estimatedPrompt,
                            contextWindow,
                            thresholdTokens,
                            'post_compact',
                        )
                    }

                    if (estimatedPrompt > contextWindow) {
                        const limitMessage = `Context tokens (${estimatedPrompt}) exceed the limit. Please shorten the input or restart the session.`
                        this.history.push({ role: 'assistant', content: limitMessage })
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
                    let toolUseBlocks: ToolCallPart[] = []
                    let toolResults: ToolResultPart[] = []
                    let usageFromLLM: Partial<LanguageModelUsage> | undefined
                    let reasoningContent: string | undefined
                    let receivedAssistantChunk = false
                    const toolContext: ToolExecutionContext = {
                        approvalManager: this.approvalManager,
                        approvalHooks: this.buildToolApprovalHooks(turn, step),
                        toolsDisabled: this.toolsDisabled,
                        onRepeatedAction: (tool, input) => this.maybeWarnRepeatedAction(tool, input),
                        gate: createStepGate(),
                    }
                    try {
                        const llmResult = await this.deps.callLLM(
                            this.history,
                            (chunk) => {
                                if (chunk) {
                                    receivedAssistantChunk = true
                                }
                                this.deps.onAssistantStep?.(chunk, step)
                            },
                            { signal: abortController.signal, toolContext, thinking: this.thinkingOverride },
                        )
                        const normalized = normalizeLLMResponse(llmResult)
                        assistantText = normalized.textContent
                        toolUseBlocks = normalized.toolUseBlocks
                        toolResults = normalized.toolResults
                        usageFromLLM = normalized.usage
                        reasoningContent = normalized.reasoningContent
                        if (assistantText.trim().length > 0) {
                            lastNonEmptyAssistantText = assistantText
                            lastNonEmptyAssistantStep = step
                        }
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
                        this.history.push({ role: 'assistant', content: msg })
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

                    if (!receivedAssistantChunk && assistantText) {
                        this.deps.onAssistantStep?.(assistantText, step)
                    }

                    const textToolCall =
                        toolUseBlocks.length === 0 && assistantText
                            ? parseTextToolCall(assistantText, this.deps.tools)
                            : null

                    // 优先使用 Tool Use API 的结果；文本仅作为最终回答处理。
                    let parsed: ParsedAssistant
                    let assistantHistoryMessage: ChatMessage | null = null
                    if (toolUseBlocks.length > 0) {
                        // Tool Use API 模式：使用结构化的工具调用。
                        // parsed.action 复用单 action 结构，取首个工具作为主 action 语义。
                        const firstTool = toolUseBlocks[0]
                        if (firstTool) {
                            // Reasoning is already separated by the AI SDK; no think-tag extraction needed.
                            const thinking = reasoningContent
                            parsed = {
                                action: {
                                    tool: firstTool.toolName,
                                    input: firstTool.input,
                                },
                                thinking,
                            }
                            assistantHistoryMessage = {
                                role: 'assistant',
                                content: [
                                    ...(assistantText ? [{ type: 'text' as const, text: assistantText }] : []),
                                    ...(reasoningContent
                                        ? [{ type: 'reasoning' as const, text: reasoningContent }]
                                        : []),
                                    ...toolUseBlocks,
                                ],
                            }
                        } else {
                            parsed = {}
                        }
                    } else if (assistantText) {
                        parsed = { final: assistantText, thinking: reasoningContent }
                        assistantHistoryMessage = {
                            role: 'assistant',
                            content: [
                                ...(assistantText ? [{ type: 'text' as const, text: assistantText }] : []),
                                ...(reasoningContent ? [{ type: 'reasoning' as const, text: reasoningContent }] : []),
                            ],
                        }
                    } else {
                        // 没有内容，视为空响应
                        parsed = {}
                    }

                    // 使用 LLM 返回的 usage 作为用量记录。本地 tokenizer 仅用于预估（压缩触发、上下文超限检查），不作为用量上报的 fallback。
                    const stepUsage: LanguageModelUsage = usageFromLLM
                        ? {
                              ...emptyUsage(),
                              inputTokens: usageFromLLM.inputTokens ?? 0,
                              outputTokens: usageFromLLM.outputTokens ?? 0,
                              totalTokens: usageFromLLM.totalTokens ?? 0,
                          }
                        : emptyUsage()
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
                        meta: {
                            tokens: stepUsage,
                            protocol_violation: Boolean(textToolCall),
                            protocol_violation_count: textToolCall
                                ? protocolViolationCount + 1
                                : protocolViolationCount || undefined,
                            thinking: reasoningContent,
                        },
                    })

                    if (textToolCall) {
                        protocolViolationCount += 1

                        const protocolError = `Model protocol error: returned plain-text tool JSON for "${textToolCall.tool}" ${protocolViolationCount} times. Structured tool calls are required.`
                        status = 'error'
                        finalText = protocolError
                        errorMessage = protocolError
                        this.history.push({ role: 'assistant', content: protocolError })
                        await this.emitEvent('final', {
                            turn,
                            step,
                            content: protocolError,
                            role: 'assistant',
                            meta: {
                                error_type: 'model_protocol_error',
                                tool: textToolCall.tool,
                                protocol_violation: true,
                                protocol_violation_count: protocolViolationCount,
                                tokens: stepUsage,
                            },
                        })
                        await runHook(this.hooks, 'onFinal', {
                            sessionId: this.id,
                            turn,
                            step,
                            finalText,
                            status,
                            errorMessage,
                            tokenUsage: stepUsage,
                            turnUsage: { ...turnUsage },
                            steps,
                        })
                        break
                    }

                    if (assistantHistoryMessage) {
                        this.history.push(assistantHistoryMessage)
                    }

                    // 工具调用已由 AI SDK 在 streamText 内执行（execute 包装器：审批/截断/禁用跳过）。
                    if (toolUseBlocks.length > 0) {
                        // 工具禁用模式：全部跳过 → 按工具禁用错误终止
                        // Outputs are MemoToolOutput at runtime (SDK types don't include the `skipped` variant).
                        const disabledSkipped = toolResults.some(
                            (tr) => (tr.output as { type: string }).type === 'skipped',
                        )
                        if (disabledSkipped) {
                            status = 'error'
                            finalText = TOOL_DISABLED_ERROR_MESSAGE
                            errorMessage = TOOL_DISABLED_ERROR_MESSAGE
                            for (const tr of toolResults) {
                                this.history.push(toToolHistoryMessage(tr))
                            }
                            this.history.push({
                                role: 'assistant',
                                content: TOOL_DISABLED_ERROR_MESSAGE,
                            })
                            await this.emitEvent('final', {
                                turn,
                                step,
                                content: TOOL_DISABLED_ERROR_MESSAGE,
                                role: 'assistant',
                                meta: {
                                    error_type: 'tool_disabled',
                                    tool_count: toolUseBlocks.length,
                                    tools: toolUseBlocks.map((block) => block.toolName).join(','),
                                    tokens: stepUsage,
                                },
                            })
                            await runHook(this.hooks, 'onFinal', {
                                sessionId: this.id,
                                turn,
                                step,
                                finalText,
                                status,
                                errorMessage,
                                tokenUsage: stepUsage,
                                turnUsage: { ...turnUsage },
                                steps,
                            })
                            break
                        }

                        // 重复调用防呆
                        for (const block of toolUseBlocks) {
                            this.maybeWarnRepeatedAction(block.toolName, block.input)
                        }

                        // action 事件（批次级）
                        await this.emitEvent('action', {
                            turn,
                            step,
                            meta: {
                                tools: toolUseBlocks.map((b) => b.toolName),
                                action_ids: toolUseBlocks.map((b) => b.toolCallId),
                                action_id: toolUseBlocks[0]?.toolCallId,
                                parallel: toolUseBlocks.length > 1,
                                phase: 'dispatch',
                                thinking: parsed.thinking,
                            },
                        })
                        await runHook(this.hooks, 'onAction', {
                            sessionId: this.id,
                            turn,
                            step,
                            action: { tool: toolUseBlocks[0]?.toolName ?? '', input: toolUseBlocks[0]?.input },
                            parallelActions: toolUseBlocks.map((b) => ({ tool: b.toolName, input: b.input })),
                            thinking: parsed.thinking,
                            history: snapshotHistory(this.history),
                        })

                        // 逐结果回填历史 + observation 事件
                        const observations: string[] = []
                        const resultStatuses: ToolActionStatus[] = []
                        let denied = false
                        for (const [idx, tr] of toolResults.entries()) {
                            const observation = outputToObservation(tr)
                            const status = mapOutputStatus(tr)
                            observations.push(observation)
                            resultStatuses.push(status)
                            this.history.push(toToolHistoryMessage(tr))
                            await this.emitEvent('observation', {
                                turn,
                                step,
                                content: observation,
                                meta: {
                                    tool: tr.toolName,
                                    index: idx,
                                    action_id: tr.toolCallId,
                                    phase: 'result',
                                    status,
                                    error_type: status === 'success' ? undefined : status,
                                },
                            })
                            if (tr.output.type === 'execution-denied') denied = true
                        }
                        const combinedObservation = observations
                            .map((obs, i) => `[${toolResults[i]?.toolName ?? ''}]: ${obs}`)
                            .join('\n\n')
                        const hookObservation = toolResults.length > 1 ? combinedObservation : (observations[0] ?? '')
                        const lastStep = steps[steps.length - 1]
                        if (lastStep) {
                            lastStep.observation = hookObservation
                        }
                        const resultStatus =
                            resultStatuses.find((candidate) => candidate !== TOOL_ACTION_SUCCESS_STATUS) ??
                            TOOL_ACTION_SUCCESS_STATUS
                        await runHook(this.hooks, 'onObservation', {
                            sessionId: this.id,
                            turn,
                            step,
                            tool: toolUseBlocks.map((b) => b.toolName).join(', '),
                            observation: hookObservation,
                            resultStatus,
                            parallelResultStatuses: resultStatuses,
                            history: snapshotHistory(this.history),
                        })

                        // 拒绝 → 终止本轮（保持现状语义）
                        if (denied) {
                            const deniedResult = toolResults.find((tr) => tr.output.type === 'execution-denied')
                            status = 'cancelled'
                            finalText = '用户拒绝了工具执行，已停止当前操作。'
                            await this.emitEvent('final', {
                                turn,
                                step,
                                content: finalText,
                                role: 'assistant',
                                meta: {
                                    rejected: true,
                                    phase: 'result',
                                    action_id: deniedResult?.toolCallId,
                                    error_type: 'approval_denied',
                                },
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
                        continue
                    }

                    // 检查是否是最终回复（无工具调用或有 final 字段）
                    if (toolUseBlocks.length === 0 || parsed.final) {
                        this.resetActionRepetition()
                        const shouldFallbackFromPreviousText =
                            toolUseBlocks.length === 0 &&
                            !parsed.final &&
                            assistantText.trim().length === 0 &&
                            Boolean(lastNonEmptyAssistantText) &&
                            lastNonEmptyAssistantStep === step - 1

                        finalText = shouldFallbackFromPreviousText
                            ? (lastNonEmptyAssistantText ?? '')
                            : parsed.final || assistantText
                        if (parsed.final) {
                            parsed.final = finalText
                        }
                        await this.emitEvent('final', {
                            turn,
                            step,
                            content: finalText,
                            role: 'assistant',
                            meta: {
                                tokens: stepUsage,
                                fallback_from_previous_text: shouldFallbackFromPreviousText || undefined,
                                thinking: reasoningContent,
                            },
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
                            thinking: reasoningContent,
                        })
                        break
                    }

                    // 无动作且未结束时，重置重复计数（保持“连续”语义）
                    this.resetActionRepetition()
                    break
                }

                if (!finalText && status !== 'cancelled') {
                    if (status === 'ok') {
                        status = 'error'
                    }
                    finalText = 'Unable to produce a final answer. Please retry or adjust the request.'
                    errorMessage = finalText
                    this.history.push({ role: 'assistant', content: finalText })
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
                        protocol_violation_count: protocolViolationCount || undefined,
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
                // 清除单次授权（每次 turn 结束后）
                this.approvalManager.clearOnceApprovals()
            }
        })
    }

    cancelCurrentTurn() {
        if (this.currentAbortController) {
            this.cancelling = true
            this.currentAbortController.abort()
        }
    }

    async compactHistory(reason: CompactReason = 'manual'): Promise<CompactResult> {
        return this.compactHistoryInternal(reason, this.turnIndex, 0)
    }

    listToolNames() {
        return Object.keys(this.deps.tools)
    }

    async close() {
        if (this.closed) return
        this.closed = true
        const hasContent = this.sessionStartEmitted || this.turnIndex >= 0
        if (hasContent) {
            await this.emitEvent('session_end', {
                meta: {
                    durationMs: Date.now() - this.startedAt,
                    tokens: this.sessionUsage,
                },
            })
            for (const sink of this.sinks) {
                try {
                    if (sink.close) {
                        await sink.close()
                    } else if (sink.flush) {
                        await sink.flush()
                    }
                } catch (err) {
                    console.error(`History flush failed: ${(err as Error).message}`)
                }
            }
        }
        // 清理所有授权
        this.approvalManager.dispose()
        if (this.deps.dispose) {
            await this.deps.dispose()
        }
    }

    /** 将结构化事件发送到所有历史 sink，独立于主流程错误。 */
    private async emitEvent(type: HistoryEvent['type'], payload: Omit<HistoryEvent, 'ts' | 'sessionId' | 'type'>) {
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

/** Helper to generate structured history events. */
export function createHistoryEvent(params: {
    sessionId: string
    type: HistoryEvent['type']
    turn?: number
    step?: number
    content?: string
    role?: Role
    meta?: Record<string, unknown>
}): HistoryEvent {
    return {
        ts: new Date().toISOString(),
        sessionId: params.sessionId,
        turn: params.turn,
        step: params.step,
        type: params.type,
        content: params.content,
        role: params.role,
        meta: params.meta,
    }
}

// --- Agent loop constants and helpers ---------------------------------------------

export type ResolvedToolPermission = {
    mode: ToolPermissionMode | 'auto'
    toolsDisabled: boolean
    dangerous: boolean
    approvalMode: 'auto' | 'strict'
}

function writeStructuredError(payload: Record<string, unknown>) {
    process.stderr.write(`${JSON.stringify(payload)}\n`)
}

export function resolveToolPermission(options: AgentSessionOptions): ResolvedToolPermission {
    if (options.toolPermissionMode === 'none') {
        return {
            mode: 'none',
            toolsDisabled: true,
            dangerous: false,
            approvalMode: 'auto',
        }
    }

    if (options.toolPermissionMode === 'once') {
        return {
            mode: 'once',
            toolsDisabled: false,
            dangerous: false,
            approvalMode: 'auto',
        }
    }

    if (options.toolPermissionMode === 'full') {
        return {
            mode: 'full',
            toolsDisabled: false,
            dangerous: true,
            approvalMode: 'auto',
        }
    }

    const dangerous = options.dangerous ?? false
    return {
        mode: dangerous ? 'full' : 'auto',
        toolsDisabled: false,
        dangerous,
        approvalMode: 'auto',
    }
}


export async function emitEventToSinks(event: HistoryEvent, sinks: HistorySink[]) {
    for (const sink of sinks) {
        try {
            await sink.append(event)
        } catch (err) {
            writeStructuredError({
                level: 'error',
                event: 'history_sink_append_failed',
                sink: sink.constructor?.name || 'anonymous_sink',
                message: (err as Error).message,
            })
        }
    }
}
