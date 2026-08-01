/** @file Session/Turn runtime core: handles ReAct loop, tool scheduling, and event logging. */
import { randomUUID } from 'node:crypto'
import { createHistoryEvent } from '@memo/core/history/history'
import { buildThinking } from '@memo/core/utils/utils'
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
    SessionMode,
    ToolPermissionMode,
    TokenCounter,
    ToolRegistry,
    TurnResult,
    TurnStatus,
} from '@memo/core/types'
import type { LanguageModelUsage } from 'ai'
import { buildHookRunners, runHook, snapshotHistory, type HookRunnerMap } from '@memo/core/agent/hooks'
import {
    createToolOrchestrator,
    type ToolApprovalHooks,
    type ToolOrchestrator,
    type ToolActionResult,
} from '@memo/tools/orchestrator'
import { runWithRuntimeContext } from '@memo/tools/runtime/context'
import {
    buildAssistantToolCalls,
    completeToolResultsForProtocol,
    normalizeLLMResponse,
    parseTextToolCall,
    toToolHistoryMessage,
} from './messages'
import type { ApprovalRequest, ApprovalDecision } from '@memo/tools/approval'
import type { ToolActionStatus } from '@memo/tools/orchestrator'

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
    private toolOrchestrator: ToolOrchestrator
    private toolsDisabled = false
    private toolPermissionMode: ToolPermissionMode | 'auto' = 'auto'

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
        this.toolOrchestrator = createToolOrchestrator({
            tools: deps.tools,
            approval: {
                dangerous: resolvedPermission.dangerous,
                mode: resolvedPermission.approvalMode,
            },
        })
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
                selected.push(message.slice(0, remaining))
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
                { tools: [] },
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

    /** 通过工具编排器执行工具调用。 */
    private async executeToolAction(
        actionId: string,
        toolName: string,
        toolInput: unknown,
        turn: number,
        step: number,
    ): Promise<ToolActionResult> {
        return this.toolOrchestrator.executeAction(
            { id: actionId, name: toolName, input: toolInput },
            this.buildToolApprovalHooks(turn, step),
        )
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
                        tokenizer: this.tokenCounter.model,
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
                    let toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = []
                    let usageFromLLM: Partial<LanguageModelUsage> | undefined
                    let reasoningContent: string | undefined
                    let receivedAssistantChunk = false
                    try {
                        const llmResult = await this.deps.callLLM(
                            this.history,
                            (chunk) => {
                                if (chunk) {
                                    receivedAssistantChunk = true
                                }
                                this.deps.onAssistantStep?.(chunk, step)
                            },
                            { signal: abortController.signal },
                        )
                        const normalized = normalizeLLMResponse(llmResult)
                        assistantText = normalized.textContent
                        toolUseBlocks = normalized.toolUseBlocks
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
                            const thinking = assistantText ? buildThinking([assistantText]) : undefined
                            parsed = {
                                action: {
                                    tool: firstTool.name,
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
                                    ...buildAssistantToolCalls(toolUseBlocks),
                                ],
                            }
                        } else {
                            parsed = {}
                        }
                    } else if (assistantText) {
                        parsed = { final: assistantText }
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

                    if (toolUseBlocks.length > 0 && this.toolsDisabled) {
                        for (const block of toolUseBlocks) {
                            this.history.push({
                                role: 'tool',
                                content: [
                                    {
                                        type: 'tool-result',
                                        toolCallId: block.id,
                                        toolName: block.name,
                                        output: { type: 'text', value: TOOL_SKIPPED_DISABLED_MESSAGE },
                                    },
                                ],
                            })
                        }
                        status = 'error'
                        finalText = TOOL_DISABLED_ERROR_MESSAGE
                        errorMessage = TOOL_DISABLED_ERROR_MESSAGE
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
                                tools: toolUseBlocks.map((block) => block.name).join(','),
                                tokens: stepUsage,
                            },
                        })
                        await runHook(this.hooks, 'onFinal', {
                            sessionId: this.id,
                            turn,
                            step,
                            finalText: TOOL_DISABLED_ERROR_MESSAGE,
                            status,
                            errorMessage,
                            tokenUsage: stepUsage,
                            turnUsage: { ...turnUsage },
                            steps,
                        })
                        break
                    }

                    // 处理工具调用（支持并发执行多个工具）
                    if (toolUseBlocks.length > 1) {
                        // 重复调用防呆：对每个工具调用记录签名
                        for (const block of toolUseBlocks) {
                            this.maybeWarnRepeatedAction(block.name, block.input)
                        }

                        // 触发 action hooks（action 字段取首个工具，parallelActions 包含全量）
                        await this.emitEvent('action', {
                            turn,
                            step,
                            meta: {
                                tools: toolUseBlocks.map((b) => b.name),
                                action_ids: toolUseBlocks.map((b) => b.id),
                                action_id: toolUseBlocks[0]?.id,
                                parallel: true,
                                phase: 'dispatch',
                                thinking: parsed.thinking,
                                // 保存所有工具的完整信息
                                toolBlocks: toolUseBlocks.map((b) => ({
                                    id: b.id,
                                    name: b.name,
                                    input: b.input,
                                })),
                            },
                        })
                        const firstTool = toolUseBlocks[0]
                        if (firstTool) {
                            await runHook(this.hooks, 'onAction', {
                                sessionId: this.id,
                                turn,
                                step,
                                action: {
                                    tool: firstTool.name,
                                    input: firstTool.input,
                                },
                                parallelActions: toolUseBlocks.map((block) => ({
                                    tool: block.name,
                                    input: block.input,
                                })),
                                thinking: parsed.thinking,
                                history: snapshotHistory(this.history),
                            })
                        }

                        const allSupportParallel = toolUseBlocks.every((block) => {
                            const tool = this.deps.tools[block.name]
                            return Boolean(tool?.supportsParallelToolCalls)
                        })
                        const hasMutatingTool = toolUseBlocks.some((block) => {
                            const tool = this.deps.tools[block.name]
                            return Boolean(tool?.isMutating)
                        })
                        const executionMode = allSupportParallel && !hasMutatingTool ? 'parallel' : 'sequential'

                        const execution = await this.toolOrchestrator.executeActions(
                            toolUseBlocks.map((block) => ({
                                id: block.id,
                                name: block.name,
                                input: block.input,
                            })),
                            {
                                ...this.buildToolApprovalHooks(turn, step),
                                executionMode,
                                failurePolicy: 'fail_fast',
                            },
                        )

                        const protocolResults = completeToolResultsForProtocol(
                            toolUseBlocks,
                            execution.results,
                            execution.hasRejection,
                        )

                        for (const [idx, result] of protocolResults.entries()) {
                            this.history.push(toToolHistoryMessage(result))
                            await this.emitEvent('observation', {
                                turn,
                                step,
                                content: result.observation,
                                meta: {
                                    tool: result.tool,
                                    index: idx,
                                    action_id: result.actionId,
                                    phase: 'result',
                                    status: result.status,
                                    error_type: result.errorType,
                                    duration_ms: result.durationMs,
                                    execution_mode: executionMode,
                                },
                            })
                        }

                        const combinedObservation = protocolResults
                            .map((result) => `[${result.tool}]: ${result.observation}`)
                            .join('\n\n')
                        const parallelResultStatuses = protocolResults.map((result) => result.status)
                        const resultStatus =
                            parallelResultStatuses.find((candidate) => candidate !== TOOL_ACTION_SUCCESS_STATUS) ??
                            TOOL_ACTION_SUCCESS_STATUS
                        const lastStep = steps[steps.length - 1]
                        if (lastStep) {
                            lastStep.observation = combinedObservation
                        }
                        // 触发 observation hook（使用合并后的结果）
                        await runHook(this.hooks, 'onObservation', {
                            sessionId: this.id,
                            turn,
                            step,
                            tool: toolUseBlocks.map((b) => b.name).join(', '),
                            observation: combinedObservation,
                            resultStatus,
                            parallelResultStatuses,
                            history: snapshotHistory(this.history),
                        })

                        // 如果被拒绝，停止本轮次
                        if (execution.hasRejection) {
                            const rejectionResult = protocolResults.find((result) => result.rejected)
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
                                    action_id: rejectionResult?.actionId,
                                    error_type: rejectionResult?.errorType ?? 'approval_denied',
                                    duration_ms: rejectionResult?.durationMs,
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

                    // 单个工具调用
                    // 注意：当 toolUseBlocks.length > 1 时，已在上面处理，这里跳过
                    else if (parsed.action) {
                        this.maybeWarnRepeatedAction(parsed.action.tool, parsed.action.input)
                        const actionId = toolUseBlocks[0]?.id ?? `${turn}:${step}:single:${parsed.action.tool}`
                        await this.emitEvent('action', {
                            turn,
                            step,
                            meta: {
                                tool: parsed.action.tool,
                                input: parsed.action.input,
                                action_id: actionId,
                                phase: 'dispatch',
                                thinking: parsed.thinking,
                            },
                        })
                        await runHook(this.hooks, 'onAction', {
                            sessionId: this.id,
                            turn,
                            step,
                            action: parsed.action,
                            thinking: parsed.thinking,
                            history: snapshotHistory(this.history),
                        })

                        // 使用审批流程执行工具
                        const result = await this.executeToolAction(
                            actionId,
                            parsed.action.tool,
                            parsed.action.input,
                            turn,
                            step,
                        )

                        // 如果被拒绝，停止本轮次
                        if (result.rejected) {
                            this.history.push(
                                toToolHistoryMessage({
                                    ...result,
                                    observation:
                                        result.observation || `User denied tool execution: ${parsed.action.tool}`,
                                }),
                            )
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
                                    action_id: result.actionId,
                                    error_type: result.errorType ?? 'approval_denied',
                                    duration_ms: result.durationMs,
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

                        const observation = result.observation

                        this.history.push({
                            role: 'tool',
                            content: [
                                {
                                    type: 'tool-result',
                                    toolCallId: result.actionId,
                                    toolName: parsed.action.tool,
                                    output: { type: 'text', value: observation },
                                },
                            ],
                        })
                        const lastStep = steps[steps.length - 1]
                        if (lastStep) {
                            lastStep.observation = observation
                        }
                        await this.emitEvent('observation', {
                            turn,
                            step,
                            content: observation,
                            meta: {
                                tool: parsed.action.tool,
                                action_id: result.actionId,
                                phase: 'result',
                                status: result.status,
                                error_type: result.errorType,
                                duration_ms: result.durationMs,
                            },
                        })
                        await runHook(this.hooks, 'onObservation', {
                            sessionId: this.id,
                            turn,
                            step,
                            tool: parsed.action.tool,
                            observation,
                            resultStatus: result.status,
                            history: snapshotHistory(this.history),
                        })
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
                this.toolOrchestrator.clearOnceApprovals()
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
        this.tokenCounter.dispose()
        // 清理所有授权
        this.toolOrchestrator.dispose()
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

// --- Agent loop constants and helpers ---------------------------------------------

export const DEFAULT_SESSION_MODE: SessionMode = 'interactive'
export const DEFAULT_CONTEXT_WINDOW = 120_000
export const TOOL_ACTION_SUCCESS_STATUS: ToolActionStatus = 'success'
export const TOOL_DISABLED_ERROR_MESSAGE =
    'Tool usage is disabled in the current permission mode. Switch to /tools once or /tools full to enable tools.'
export const SESSION_TITLE_MAX_CHARS = 60
export const TOOL_SKIPPED_DISABLED_MESSAGE = 'Tool execution skipped: tools are disabled in current permission mode.'

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

export function emptyUsage(): LanguageModelUsage {
    return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    }
}

export function accumulateUsage(target: LanguageModelUsage, delta?: Partial<LanguageModelUsage>) {
    if (!delta) return
    const inputDelta = delta.inputTokens ?? 0
    const outputDelta = delta.outputTokens ?? 0
    const totalDelta = delta.totalTokens ?? inputDelta + outputDelta
    target.inputTokens = (target.inputTokens ?? 0) + inputDelta
    target.outputTokens = (target.outputTokens ?? 0) + outputDelta
    target.totalTokens = (target.totalTokens ?? 0) + totalDelta
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

export function isAbortError(err: unknown): err is Error {
    if (!(err instanceof Error)) return false
    if (err.name === 'AbortError') return true

    const message = err.message?.toLowerCase?.() ?? ''
    return (
        message.includes('request was aborted') ||
        message.includes('operation was aborted') ||
        message.includes('aborted')
    )
}

export function truncateSessionTitle(input: string): string {
    if (input.length <= SESSION_TITLE_MAX_CHARS) return input
    return `${input.slice(0, SESSION_TITLE_MAX_CHARS - 3).trimEnd()}...`
}

export function normalizeSessionTitle(raw: string): string {
    const compact = raw
        .replace(/<\s*(think|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
        .replace(/<\s*\/?\s*(think|thinking)\b[^>]*>/gi, ' ')
        .replace(/\r?\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (!compact) return ''
    const unprefixed = compact.replace(/^(title|session title|标题)\s*[:：-]\s*/i, '').trim()
    if (!unprefixed) return ''
    const unquoted = unprefixed.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim()
    if (!unquoted) return ''
    return truncateSessionTitle(unquoted)
}

export function fallbackSessionTitleFromPrompt(input: string): string {
    const compact = input.replace(/\s+/g, ' ').trim()
    if (!compact) return 'New Session'

    // Keep short CJK/non-space prompts readable.
    if (!compact.includes(' ')) {
        return compact.length <= 20 ? compact : `${compact.slice(0, 20).trimEnd()}...`
    }

    const words = compact.split(' ').filter(Boolean)
    const short = words.slice(0, 8).join(' ')
    return truncateSessionTitle(short || compact)
}

// Stable serialization for duplicate action detection (ensures consistent key ordering)
export function stableStringify(value: unknown): string {
    return stableStringifyWithSeen(value, new WeakSet<object>(), 0)
}

const MAX_STABLE_STRINGIFY_DEPTH = 100

function stableStringifyWithSeen(value: unknown, seen: WeakSet<object>, depth: number): string {
    if (depth > MAX_STABLE_STRINGIFY_DEPTH) {
        return JSON.stringify('[MaxDepthExceeded]')
    }
    if (typeof value === 'bigint') {
        return JSON.stringify(value.toString())
    }
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
    if (seen.has(value)) {
        return JSON.stringify('[Circular]')
    }

    seen.add(value)
    if (Array.isArray(value)) {
        const result = `[${value.map((v) => stableStringifyWithSeen(v, seen, depth + 1)).join(',')}]`
        seen.delete(value)
        return result
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    const result = `{${entries
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringifyWithSeen(v, seen, depth + 1)}`)
        .join(',')}}`
    seen.delete(value)
    return result
}
