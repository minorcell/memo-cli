import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import {
    createAgentSession,
    loadMemoConfig,
    resolveContextWindowForProvider,
    selectProvider,
    writeMemoConfig,
    type ApprovalDecision,
    type AgentSession,
    type AgentSessionDeps,
    type AgentSessionOptions,
    type ChatMessage,
    type MCPServerConfig,
    type ModelProfileOverride,
    type ProviderConfig,
} from '@memo/core'
import { ApprovalQueue } from './approvalQueue'
import {
    createInitialRuntimeState,
    pendingRuntimeApproval,
    runtimeReducer,
    runtimeStatus,
    type TurnRequest,
} from './runtimeState'
import { VisibleUpdateQueue, type VisibleUpdate } from './visibleUpdateQueue'
import { ChatWidget } from '../features/timeline/ChatWidget'
import { Composer } from '../features/composer/Composer'
import { Footer } from '../shared/ui/Footer'
import { ApprovalOverlay } from '../features/approval/ApprovalOverlay'
import { McpActivationOverlay } from '../features/mcp/McpActivationOverlay'
import { notifyApprovalRequested } from '../features/approval/approvalNotification'
import { PlanPanel } from '../features/plan/PlanPanel'
import { planStateReducer } from '../features/plan/planState'
import { SetupWizard } from '../features/setup/SetupWizard'
import { parseHistoryLog } from '../features/session/historyParser'
import { chatTimelineReducer, createInitialTimelineState } from '../features/timeline/chatTimeline'
import { calculateContextPercent, inferParallelToolStatuses, inferToolStatus } from '../shared/lib/utils'
import { checkForUpdate, findLocalPackageInfoSync } from '../shared/lib/version'
import type { SessionHistoryEntry } from '../features/session/sessionHistory'
import { loadTaskPrompt } from '../shared/lib/taskPrompt'
import {
    formatSlashCommand,
    PLAIN_EXIT_COMMAND,
    SLASH_COMMANDS,
    TOOL_PERMISSION_MODES,
    type ToolPermissionMode,
} from '../shared/lib/constants'
import type { ParsedHistoryLog } from '../features/session/historyParser'

export type AppProps = {
    sessionOptions: AgentSessionOptions
    providerName: string
    model: string
    configPath: string
    mcpServers: Record<string, MCPServerConfig>
    cwd: string
    sessionsDir: string
    providers: ProviderConfig[]
    modelProfiles?: Record<string, ModelProfileOverride>
    dangerous?: boolean
    needsSetup?: boolean
    initialHistory?: ParsedHistoryLog
}

function normalizeActiveMcpServers(availableNames: string[], configuredActiveNames: string[] | undefined): string[] {
    if (availableNames.length === 0) return []
    if (configuredActiveNames === undefined) {
        return [...availableNames]
    }
    if (configuredActiveNames.length === 0) {
        return []
    }

    const available = new Set(availableNames)
    const normalized = configuredActiveNames.filter((name) => available.has(name))
    return normalized.length > 0 ? normalized : [...availableNames]
}

function normalizeMcpSelection(availableNames: string[], selectedNames: string[]): string[] {
    if (availableNames.length === 0) return []
    if (selectedNames.length === 0) return []
    const available = new Set(availableNames)
    return selectedNames.filter((name) => available.has(name))
}

function clearTerminalScreen() {
    try {
        if (process.stdout?.isTTY) {
            process.stdout.write('\x1Bc')
        }
    } catch {
        // Best-effort terminal clear.
    }
}

export function App({
    sessionOptions,
    providerName,
    model,
    configPath,
    mcpServers,
    cwd,
    sessionsDir,
    providers,
    modelProfiles,
    dangerous = false,
    needsSetup = false,
    initialHistory,
}: AppProps) {
    const { exit } = useApp()
    const availableMcpServerNames = useMemo(() => Object.keys(mcpServers ?? {}).sort(), [mcpServers])
    const initialActiveMcpServers = useMemo(
        () => normalizeActiveMcpServers(availableMcpServerNames, sessionOptions.activeMcpServers),
        [availableMcpServerNames, sessionOptions.activeMcpServers],
    )
    const defaultToolPermissionMode: ToolPermissionMode =
        sessionOptions.toolPermissionMode ?? (dangerous ? TOOL_PERMISSION_MODES.FULL : TOOL_PERMISSION_MODES.ONCE)

    const [timeline, dispatchTimeline] = useReducer(chatTimelineReducer, undefined, createInitialTimelineState)
    const [runtime, dispatchRuntime] = useReducer(runtimeReducer, undefined, createInitialRuntimeState)
    const [activePlan, dispatchPlan] = useReducer(planStateReducer, null)

    const [currentProvider, setCurrentProvider] = useState(providerName)
    const [currentModel, setCurrentModel] = useState(model)
    const [providersState, setProvidersState] = useState(providers)
    const [modelProfilesState, setModelProfilesState] = useState(modelProfiles)
    const [toolPermissionMode, setToolPermissionMode] = useState<ToolPermissionMode>(defaultToolPermissionMode)
    const [thinkingOn, setThinkingOn] = useState<boolean>(() => {
        const override = modelProfilesState?.[model] ?? modelProfilesState?.[`${providerName}:${model}`]
        return override?.supports_reasoning_content ?? true
    })
    const thinkingOnRef = useRef(thinkingOn)

    const resolveContextLimit = useCallback(
        (providerConfig: Pick<ProviderConfig, 'name' | 'model'>) =>
            resolveContextWindowForProvider({ model_profiles: modelProfilesState }, providerConfig),
        [modelProfilesState],
    )

    const [sessionOptionsState, setSessionOptionsState] = useState<AgentSessionOptions>({
        ...sessionOptions,
        providerName,
        modelName: model,
        contextWindow: resolveContextLimit({ name: providerName, model }),
        dangerous: defaultToolPermissionMode === TOOL_PERMISSION_MODES.FULL,
        toolPermissionMode: defaultToolPermissionMode,
        thinking: thinkingOn,
    })

    const [inputHistory, setInputHistory] = useState<string[]>([])

    const [contextLimit, setContextLimit] = useState<number>(resolveContextLimit({ name: providerName, model }))
    const [currentContextTokens, setCurrentContextTokens] = useState(0)
    const [followOutput, setFollowOutput] = useState(true)

    const [setupPending, setSetupPending] = useState(needsSetup)
    const [mcpSelectionPending, setMcpSelectionPending] = useState(!needsSetup && availableMcpServerNames.length > 0)
    const [activeMcpServerNames, setActiveMcpServerNames] = useState<string[]>(initialActiveMcpServers)
    const [exitMessage, setExitMessage] = useState<string | null>(null)

    const [sessionLogPath, setSessionLogPath] = useState<string | null>(null)
    const [pendingHistoryMessages, setPendingHistoryMessages] = useState<ChatMessage[] | null>(null)
    const [session, setSession] = useState<AgentSession | null>(null)
    const sessionRef = useRef<AgentSession | null>(null)
    const currentTurnRef = useRef<number | null>(null)
    const nextUserInputOverrideRef = useRef<string | null>(null)
    const startedOperationRef = useRef<number | null>(null)
    const followOutputRef = useRef(true)

    const applyVisibleUpdate = useCallback((update: VisibleUpdate) => {
        if (update.kind === 'timeline') {
            dispatchTimeline(update.action)
        } else if (update.kind === 'plan') {
            dispatchPlan(update.action)
        } else {
            setCurrentContextTokens(update.promptTokens)
        }
    }, [])
    const visibleUpdateQueueRef = useRef<VisibleUpdateQueue | null>(null)
    if (!visibleUpdateQueueRef.current) {
        visibleUpdateQueueRef.current = new VisibleUpdateQueue(applyVisibleUpdate)
    }
    const visibleUpdateQueue = visibleUpdateQueueRef.current

    const setOutputFollowing = useCallback(
        (following: boolean) => {
            followOutputRef.current = following
            visibleUpdateQueue.setFollowing(following)
            setFollowOutput(following)
        },
        [visibleUpdateQueue],
    )

    const resetVisibleOutput = useCallback(() => {
        visibleUpdateQueue.clear()
        followOutputRef.current = true
        visibleUpdateQueue.setFollowing(true)
        setFollowOutput(true)
    }, [visibleUpdateQueue])

    const operationStatus = runtimeStatus(runtime)
    const pendingApproval = pendingRuntimeApproval(runtime)
    const approvalQueueRef = useRef<ApprovalQueue | null>(null)
    if (!approvalQueueRef.current) {
        approvalQueueRef.current = new ApprovalQueue((request) => {
            dispatchRuntime(request ? { type: 'approval_requested', request } : { type: 'approval_resolved' })
        })
    }
    const approvalQueue = approvalQueueRef.current
    const handleApprovalDecision = useCallback(
        (decision: ApprovalDecision) => {
            approvalQueue.decide(decision)
        },
        [approvalQueue],
    )

    const handleToggleThinking = useCallback(() => {
        setThinkingOn((prev) => {
            const next = !prev
            thinkingOnRef.current = next
            sessionRef.current?.setThinking?.(next)
            return next
        })
    }, [])

    const handleToggleFollowOutput = useCallback(() => {
        if (followOutputRef.current && runtime.active?.kind !== 'turn') return
        setOutputFollowing(!followOutputRef.current)
    }, [runtime.active, setOutputFollowing])

    const localPackageInfo = useMemo(() => findLocalPackageInfoSync(), [])

    const restoreSessionUiState = useCallback((parsed: ParsedHistoryLog) => {
        const restoredToolPermissionMode =
            parsed.toolPermissionMode === 'none' ||
            parsed.toolPermissionMode === 'once' ||
            parsed.toolPermissionMode === 'full'
                ? parsed.toolPermissionMode
                : undefined
        if (parsed.providerName) setCurrentProvider(parsed.providerName)
        if (parsed.modelName) setCurrentModel(parsed.modelName)
        if (typeof parsed.thinking === 'boolean') {
            thinkingOnRef.current = parsed.thinking
            setThinkingOn(parsed.thinking)
        }
        if (restoredToolPermissionMode) setToolPermissionMode(restoredToolPermissionMode)
        setInputHistory(parsed.turns.map((turn) => turn.userInput.trim()).filter(Boolean))
        setSessionOptionsState((prev) => ({
            ...prev,
            providerName: parsed.providerName ?? prev.providerName,
            modelName: parsed.modelName ?? prev.modelName,
            toolPermissionMode: restoredToolPermissionMode ?? prev.toolPermissionMode,
            dangerous:
                restoredToolPermissionMode === undefined
                    ? prev.dangerous
                    : restoredToolPermissionMode === TOOL_PERMISSION_MODES.FULL,
            thinking: typeof parsed.thinking === 'boolean' ? parsed.thinking : prev.thinking,
        }))
    }, [])

    useEffect(() => {
        if (!initialHistory) return
        resetVisibleOutput()
        dispatchTimeline({ type: 'clear_current_timeline' })
        dispatchTimeline({
            type: 'replace_history',
            turns: initialHistory.turns,
            agents: initialHistory.agents,
            maxSequence: initialHistory.maxSequence,
        })
        dispatchPlan({ type: 'restore_history', turns: initialHistory.turns })
        setPendingHistoryMessages(initialHistory.messages)
        restoreSessionUiState(initialHistory)
    }, [dispatchTimeline, initialHistory, resetVisibleOutput, restoreSessionUiState])

    useEffect(() => {
        if (setupPending) return
        setActiveMcpServerNames(initialActiveMcpServers)
        setMcpSelectionPending(availableMcpServerNames.length > 0)
    }, [setupPending, initialActiveMcpServers, availableMcpServerNames.length])

    const appendSystemMessage = useCallback(
        (title: string, content: string, tone: 'info' | 'warning' | 'error' = 'info') => {
            dispatchTimeline({ type: 'append_system_message', title, content, tone })
        },
        [dispatchTimeline],
    )

    const deps = useMemo<AgentSessionDeps>(
        () => ({
            onAssistantStep: (chunk: string, step: number, sessionId?: string) => {
                if (sessionId && sessionId !== sessionRef.current?.id) return
                const turn = currentTurnRef.current
                if (!turn) return
                visibleUpdateQueue.enqueue({
                    kind: 'timeline',
                    action: { type: 'assistant_chunk', turn, step, chunk },
                })
            },
            onReasoningChunk: (chunk: string, step: number, sessionId?: string) => {
                if (sessionId && sessionId !== sessionRef.current?.id) return
                const turn = currentTurnRef.current
                if (!turn) return
                visibleUpdateQueue.enqueue({
                    kind: 'timeline',
                    action: { type: 'reasoning_chunk', turn, step, chunk },
                })
            },
            onAgentActivity: (activity) => {
                visibleUpdateQueue.enqueue({
                    kind: 'timeline',
                    action: { type: 'agent_status', activity },
                })
            },
            requestApproval:
                toolPermissionMode === TOOL_PERMISSION_MODES.FULL || toolPermissionMode === TOOL_PERMISSION_MODES.NONE
                    ? undefined
                    : (request) => {
                          void notifyApprovalRequested(request)
                          return approvalQueue.request(request)
                      },
            hooks: {
                onTurnStart: ({ turn, input, promptTokens }) => {
                    currentTurnRef.current = turn
                    const override = nextUserInputOverrideRef.current
                    if (override) {
                        nextUserInputOverrideRef.current = null
                    }
                    const displayInput = override ?? input

                    const updates: VisibleUpdate[] = []
                    if (promptTokens && promptTokens > 0) {
                        updates.push({ kind: 'context', promptTokens })
                    }
                    updates.push({
                        kind: 'timeline',
                        action: {
                            type: 'turn_start',
                            turn,
                            input: displayInput,
                            promptTokens,
                        },
                    })
                    visibleUpdateQueue.enqueueMany(updates)
                },
                onContextUsage: ({ turn, step, promptTokens, phase }) => {
                    visibleUpdateQueue.enqueueMany([
                        { kind: 'context', promptTokens },
                        {
                            kind: 'timeline',
                            action: {
                                type: 'context_usage',
                                turn,
                                step,
                                promptTokens,
                                phase,
                            },
                        },
                    ])
                },
                onContextCompacted: ({ reason, status, beforeTokens, afterTokens, reductionPercent, errorMessage }) => {
                    const compactedBy = reason === 'manual' ? 'manual command' : 'auto trigger'
                    let content: string
                    let tone: 'info' | 'warning' = 'info'
                    if (status === 'success') {
                        content = `Compacted by ${compactedBy}: ${beforeTokens} -> ${afterTokens} tokens (${reductionPercent.toFixed(2)}% reduced).`
                    } else if (status === 'skipped') {
                        content = `Skipped (${compactedBy}): nothing to compact.`
                        tone = 'warning'
                    } else {
                        content = `Failed (${compactedBy}): ${errorMessage ?? 'unknown error'}`
                        tone = 'warning'
                    }
                    const updates: VisibleUpdate[] = []
                    if (status === 'success') updates.push({ kind: 'context', promptTokens: afterTokens })
                    updates.push({
                        kind: 'timeline',
                        action: { type: 'append_system_message', title: 'Context compacted', content, tone },
                    })
                    visibleUpdateQueue.enqueueMany(updates)
                },
                onAction: ({ turn, step, action, thinking, parallelActions }) => {
                    visibleUpdateQueue.enqueue({
                        kind: 'timeline',
                        action: {
                            type: 'tool_action',
                            turn,
                            step,
                            action,
                            thinking,
                            parallelActions,
                        },
                    })
                },
                onObservation: ({ turn, step, observation, resultStatus, parallelResultStatuses, results }) => {
                    const toolResults = results.map((result) => ({
                        toolCallId: result.toolCallId,
                        tool: result.tool,
                        observation: result.observation,
                        status: inferToolStatus(result.status),
                    }))
                    visibleUpdateQueue.enqueueMany([
                        {
                            kind: 'timeline',
                            action: {
                                type: 'tool_observation',
                                turn,
                                step,
                                observation,
                                toolStatus: inferToolStatus(resultStatus),
                                parallelToolStatuses: inferParallelToolStatuses(parallelResultStatuses),
                                toolResults,
                            },
                        },
                        ...toolResults.map(
                            (result): VisibleUpdate => ({
                                kind: 'plan',
                                action: { type: 'tool_result', result },
                            }),
                        ),
                    ])
                },
                onFinal: ({ turn, finalText, status, errorMessage, turnUsage, tokenUsage, thinking }) => {
                    visibleUpdateQueue.enqueue({
                        kind: 'timeline',
                        action: {
                            type: 'turn_final',
                            turn,
                            finalText,
                            status,
                            errorMessage,
                            turnUsage,
                            tokenUsage,
                            thinking,
                        },
                    })
                },
            },
        }),
        [approvalQueue, toolPermissionMode, visibleUpdateQueue],
    )

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            if (setupPending || mcpSelectionPending) return

            try {
                const previous = sessionRef.current
                if (previous) {
                    await previous.close()
                }

                const created = await createAgentSession(deps, {
                    ...sessionOptionsState,
                    thinking: thinkingOnRef.current,
                })
                if (cancelled) {
                    await created.close()
                    return
                }

                sessionRef.current = created
                setSession(created)
                setSessionLogPath(created.historyFilePath ?? null)
            } catch (err) {
                if (cancelled) return
                sessionRef.current = null
                setSession(null)
                setSessionLogPath(null)
                resetVisibleOutput()
                dispatchRuntime({ type: 'reset' })
                appendSystemMessage('Session', `Failed to create session: ${(err as Error).message}`, 'error')
            }
        })()

        return () => {
            cancelled = true
        }
    }, [appendSystemMessage, deps, mcpSelectionPending, resetVisibleOutput, sessionOptionsState, setupPending])

    useEffect(() => () => visibleUpdateQueue.dispose(), [visibleUpdateQueue])
    useEffect(() => {
        return () => {
            if (sessionRef.current) {
                void sessionRef.current.close()
            }
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const update = await checkForUpdate()
            if (cancelled || !update) return
            appendSystemMessage(
                'Update',
                `Update available: v${update.latest}. Run: npm install -g @memo-code/memo@latest`,
            )
        })()

        return () => {
            cancelled = true
        }
    }, [appendSystemMessage])

    const handleExit = useCallback(async () => {
        approvalQueue.denyAll()
        if (runtime.active?.kind === 'turn') {
            dispatchRuntime({ type: 'cancel_requested' })
        }
        if (sessionRef.current) {
            await sessionRef.current.close()
        }
        setExitMessage('Bye!')
    }, [approvalQueue, runtime.active])

    // Render the farewell message first, then unmount.
    useEffect(() => {
        if (exitMessage) {
            exit()
        }
    }, [exit, exitMessage])

    const guardActiveOperation = useCallback(
        (action: string): boolean => {
            if (!runtime.active) return false
            const message =
                operationStatus === 'awaiting_approval'
                    ? 'Resolve the current approval request before proceeding.'
                    : operationStatus === 'compacting'
                      ? 'Wait for context compaction to finish before proceeding.'
                      : operationStatus === 'cancelling'
                        ? 'Wait for cancellation to finish before proceeding.'
                        : 'Cancel the current run before proceeding.'
            appendSystemMessage(action, message, 'warning')
            return true
        },
        [appendSystemMessage, operationStatus, runtime.active],
    )

    const handleClear = useCallback(() => {
        if (guardActiveOperation('Clear')) return
        resetVisibleOutput()
        dispatchTimeline({ type: 'clear_current_timeline' })
        setPendingHistoryMessages(null)
        setCurrentContextTokens(0)
        clearTerminalScreen()
    }, [dispatchTimeline, guardActiveOperation, resetVisibleOutput])

    const handleNewSession = useCallback(() => {
        if (guardActiveOperation('New Session')) return
        resetVisibleOutput()
        dispatchTimeline({ type: 'reset_all' })
        dispatchRuntime({ type: 'reset' })
        dispatchPlan({ type: 'clear' })
        setPendingHistoryMessages(null)
        setCurrentContextTokens(0)
        currentTurnRef.current = null
        setSessionOptionsState((prev) => ({
            ...prev,
            sessionId: randomUUID(),
        }))
        appendSystemMessage('New Session', 'Started a fresh session.')
    }, [appendSystemMessage, dispatchTimeline, guardActiveOperation, resetVisibleOutput])

    const persistCurrentProvider = useCallback(
        async (name: string) => {
            try {
                const loaded = await loadMemoConfig()
                await writeMemoConfig(loaded.configPath, {
                    ...loaded.config,
                    current_provider: name,
                })
            } catch (err) {
                appendSystemMessage('Config', `Failed to persist provider: ${(err as Error).message}`, 'warning')
            }
        },
        [appendSystemMessage],
    )

    const handleModelSelect = useCallback(
        async (provider: ProviderConfig) => {
            if (guardActiveOperation('Model switch')) return

            if (provider.name === currentProvider && provider.model === currentModel) {
                appendSystemMessage('Model switch', `Already using ${provider.name} (${provider.model}).`)
                return
            }

            resetVisibleOutput()
            dispatchTimeline({ type: 'reset_all' })
            dispatchRuntime({ type: 'reset' })
            dispatchPlan({ type: 'clear' })
            setCurrentContextTokens(0)
            currentTurnRef.current = null

            const nextContextLimit = resolveContextLimit(provider)
            setCurrentProvider(provider.name)
            setCurrentModel(provider.model)
            setContextLimit(nextContextLimit)
            setSessionOptionsState((prev) => ({
                ...prev,
                sessionId: randomUUID(),
                providerName: provider.name,
                modelName: provider.model,
                contextWindow: nextContextLimit,
            }))

            await persistCurrentProvider(provider.name)
            appendSystemMessage('Model switch', `Switched to ${provider.name} (${provider.model}).`)
        },
        [
            appendSystemMessage,
            currentModel,
            currentProvider,
            dispatchTimeline,
            guardActiveOperation,
            persistCurrentProvider,
            resetVisibleOutput,
            resolveContextLimit,
        ],
    )

    const toolPermissionLabel = useCallback((mode: ToolPermissionMode): string => {
        if (mode === TOOL_PERMISSION_MODES.NONE) return 'none (no tools)'
        if (mode === TOOL_PERMISSION_MODES.ONCE) return 'once (approval required)'
        return 'full (no approval)'
    }, [])

    const handleSetToolPermission = useCallback(
        (mode: ToolPermissionMode) => {
            if (guardActiveOperation('Tools')) return

            if (mode === toolPermissionMode) {
                appendSystemMessage('Tools', `Already using ${toolPermissionLabel(mode)}.`)
                return
            }

            // Tool permission is baked into the session at creation time, so
            // switching modes recreates the session; reset the visible timeline
            // to match the fresh session's (empty) history.
            setToolPermissionMode(mode)
            resetVisibleOutput()
            dispatchTimeline({ type: 'reset_all' })
            dispatchRuntime({ type: 'reset' })
            dispatchPlan({ type: 'clear' })
            setCurrentContextTokens(0)
            currentTurnRef.current = null
            setSessionOptionsState((prev) => ({
                ...prev,
                sessionId: randomUUID(),
                dangerous: mode === TOOL_PERMISSION_MODES.FULL,
                toolPermissionMode: mode,
            }))
            appendSystemMessage('Tools', `Tool permission set to ${toolPermissionLabel(mode)}. Conversation reset.`)
        },
        [
            appendSystemMessage,
            dispatchTimeline,
            guardActiveOperation,
            resetVisibleOutput,
            toolPermissionLabel,
            toolPermissionMode,
        ],
    )

    const persistActiveMcpServers = useCallback(
        async (names: string[]) => {
            try {
                const loaded = await loadMemoConfig()
                await writeMemoConfig(loaded.configPath, {
                    ...loaded.config,
                    active_mcp_servers: names,
                })
            } catch (err) {
                appendSystemMessage('MCP', `Failed to persist active MCP servers: ${(err as Error).message}`, 'warning')
            }
        },
        [appendSystemMessage],
    )

    const handleConfirmMcpActivation = useCallback(
        (selectedNames: string[], persistSelection: boolean) => {
            const normalized = normalizeMcpSelection(availableMcpServerNames, selectedNames)
            setActiveMcpServerNames(normalized)
            setMcpSelectionPending(false)
            setSessionOptionsState((prev) => ({
                ...prev,
                sessionId: randomUUID(),
                activeMcpServers: normalized,
            }))

            if (persistSelection) {
                void persistActiveMcpServers(normalized)
            }
        },
        [availableMcpServerNames, persistActiveMcpServers],
    )

    const handleHistorySelect = useCallback(
        async (entry: SessionHistoryEntry) => {
            if (guardActiveOperation('History')) return
            try {
                const raw = await readFile(entry.sessionFile, 'utf8')
                const parsed = parseHistoryLog(raw)
                resetVisibleOutput()
                dispatchTimeline({ type: 'clear_current_timeline' })
                dispatchTimeline({
                    type: 'replace_history',
                    turns: parsed.turns,
                    agents: parsed.agents,
                    maxSequence: parsed.maxSequence,
                })
                dispatchPlan({ type: 'restore_history', turns: parsed.turns })
                setPendingHistoryMessages(parsed.messages)
                dispatchRuntime({ type: 'reset' })
                setSession(null)
                setSessionLogPath(null)
                setCurrentContextTokens(0)
                currentTurnRef.current = null
                restoreSessionUiState(parsed)
                setSessionOptionsState((prev) => ({ ...prev, sessionId: randomUUID() }))
            } catch (err) {
                appendSystemMessage(
                    'History',
                    `Failed to load ${entry.sessionFile}: ${(err as Error).message}`,
                    'error',
                )
            }
        },
        [appendSystemMessage, dispatchTimeline, guardActiveOperation, resetVisibleOutput, restoreSessionUiState],
    )

    const handleCancelRun = useCallback(() => {
        if (runtime.active?.kind !== 'turn') return
        approvalQueue.denySource(session?.id)
        dispatchRuntime({ type: 'cancel_requested' })
        session?.cancelCurrentTurn?.()
    }, [approvalQueue, runtime.active, session])

    const runCompactCommand = useCallback(() => {
        if (!session) return
        if (runtime.active) {
            const message =
                runtime.active.kind === 'compact'
                    ? 'Context compaction is already running.'
                    : 'Compact is unavailable while a turn is running.'
            appendSystemMessage('Compact', message, 'warning')
            return
        }
        dispatchRuntime({ type: 'start_compact' })
    }, [appendSystemMessage, runtime.active, session])

    const runInitCommand = useCallback(async () => {
        if (!session) return
        if (runtime.active) {
            appendSystemMessage('Init', 'Init is unavailable while a turn is running.', 'warning')
            return
        }

        const initCommand = formatSlashCommand(SLASH_COMMANDS.INIT)
        const targetSessionId = session.id
        try {
            const prompt = await loadTaskPrompt('init_agents')
            if (sessionRef.current?.id !== targetSessionId) {
                appendSystemMessage('Init', 'Session changed before the init task could start.', 'warning')
                return
            }
            setInputHistory((prev) => [...prev, initCommand])
            dispatchRuntime({
                type: 'submit_turn',
                request: {
                    id: randomUUID(),
                    input: prompt,
                    displayInput: initCommand,
                },
            })
        } catch (err) {
            appendSystemMessage('Init', `Failed to run init task: ${(err as Error).message}`, 'error')
        }
    }, [appendSystemMessage, runtime.active, session])

    const handleSubmit = useCallback(
        async (value: string) => {
            const trimmed = value.trim()
            if (!trimmed) return

            if (trimmed.toLowerCase() === PLAIN_EXIT_COMMAND) {
                await handleExit()
                return
            }

            if (!followOutputRef.current) {
                setOutputFollowing(true)
            }

            if (trimmed === formatSlashCommand(SLASH_COMMANDS.INIT)) {
                await runInitCommand()
                return
            }

            if (!session) return

            setInputHistory((prev) => [...prev, trimmed])
            const request: TurnRequest = {
                id: randomUUID(),
                input: trimmed,
                displayInput: trimmed,
            }
            dispatchRuntime({ type: 'submit_turn', request })
        },
        [handleExit, runInitCommand, session, setOutputFollowing],
    )

    useEffect(() => {
        const active = runtime.active
        if (!active || !session || startedOperationRef.current === active.id) return
        startedOperationRef.current = active.id

        void (async () => {
            try {
                if (active.kind === 'compact') {
                    const result = await session.compactHistory('manual')
                    setCurrentContextTokens(result.afterTokens)
                    return
                }

                const override =
                    active.request.displayInput !== active.request.input ? active.request.displayInput : null
                nextUserInputOverrideRef.current = override
                await session.runTurn(active.request.input)
            } catch (err) {
                const title = active.kind === 'compact' ? 'Compact' : 'Run'
                appendSystemMessage(title, `${title} failed: ${(err as Error).message}`, 'error')
            } finally {
                if (active.kind === 'turn' && nextUserInputOverrideRef.current === active.request.displayInput) {
                    nextUserInputOverrideRef.current = null
                }
                dispatchRuntime({ type: 'operation_finished', operationId: active.id })
            }
        })()
    }, [appendSystemMessage, runtime.active, session])

    const handleSetupComplete = useCallback(async () => {
        try {
            const loaded = await loadMemoConfig()
            const provider = selectProvider(loaded.config)
            const nextContextLimit = resolveContextWindowForProvider(loaded.config, provider)
            setProvidersState(loaded.config.providers)
            setModelProfilesState(loaded.config.model_profiles)
            setCurrentProvider(provider.name)
            setCurrentModel(provider.model)
            setContextLimit(nextContextLimit)
            setSessionOptionsState((prev) => ({
                ...prev,
                sessionId: randomUUID(),
                providerName: provider.name,
                modelName: provider.model,
                contextWindow: nextContextLimit,
                autoCompactThresholdPercent: loaded.config.auto_compact_threshold_percent,
            }))
            setSetupPending(false)
            appendSystemMessage('Setup', `Config saved to ${loaded.configPath}`)
        } catch (err) {
            appendSystemMessage('Setup', `Failed to reload config: ${(err as Error).message}`, 'error')
        }
    }, [appendSystemMessage])

    useEffect(() => {
        if (!session || !pendingHistoryMessages?.length) return
        const systemMessage = session.history[0]
        if (!systemMessage) return
        session.history.splice(0, session.history.length, systemMessage, ...pendingHistoryMessages)
        setPendingHistoryMessages(null)
    }, [pendingHistoryMessages, session])

    const contextPercent = calculateContextPercent(currentContextTokens, contextLimit)
    const chatHeader = useMemo(
        () => ({
            providerName: currentProvider,
            model: currentModel,
            cwd,
            sessionId: sessionOptionsState.sessionId ?? 'unknown',
            mcpNames: activeMcpServerNames,
            version: localPackageInfo?.version ?? 'unknown',
        }),
        [
            activeMcpServerNames,
            currentModel,
            currentProvider,
            cwd,
            localPackageInfo?.version,
            sessionOptionsState.sessionId,
        ],
    )

    if (exitMessage) {
        return (
            <Box>
                <Text color="green">{exitMessage}</Text>
            </Box>
        )
    }

    if (setupPending) {
        return <SetupWizard configPath={configPath} onComplete={handleSetupComplete} />
    }

    if (mcpSelectionPending) {
        return (
            <McpActivationOverlay
                serverNames={availableMcpServerNames}
                defaultSelected={initialActiveMcpServers}
                onConfirm={handleConfirmMcpActivation}
            />
        )
    }

    return (
        <Box flexDirection="column">
            <ChatWidget
                header={chatHeader}
                systemMessages={timeline.systemMessages}
                turns={timeline.turns}
                historicalTurns={timeline.historicalTurns}
                agents={timeline.agents}
            />

            {activePlan ? <PlanPanel plan={activePlan} /> : null}

            <Composer
                disabled={!session || operationStatus === 'awaiting_approval'}
                operationStatus={operationStatus}
                history={inputHistory}
                cwd={cwd}
                sessionsDir={sessionsDir}
                currentSessionFile={sessionLogPath ?? undefined}
                providers={providersState}
                configPath={configPath}
                providerName={currentProvider}
                model={currentModel}
                toolPermissionMode={toolPermissionMode}
                mcpServers={mcpServers}
                onSubmit={(input) => {
                    void handleSubmit(input)
                }}
                onExit={() => {
                    void handleExit()
                }}
                onClear={handleClear}
                onNewSession={handleNewSession}
                onCancelRun={handleCancelRun}
                onCompact={() => {
                    void runCompactCommand()
                }}
                onToggleThinking={handleToggleThinking}
                onToggleFollowOutput={handleToggleFollowOutput}
                onHistorySelect={(entry) => {
                    void handleHistorySelect(entry)
                }}
                onModelSelect={(provider) => {
                    void handleModelSelect(provider)
                }}
                onSetToolPermission={handleSetToolPermission}
                thinkingOn={thinkingOn}
                onSystemMessage={appendSystemMessage}
            />

            {pendingApproval ? <ApprovalOverlay request={pendingApproval} onDecision={handleApprovalDecision} /> : null}

            <Footer
                operationStatus={operationStatus}
                queuedCount={runtime.queuedTurns.length}
                contextPercent={contextPercent}
                thinkingOn={thinkingOn}
                followOutput={followOutput}
                activeAgentCount={
                    timeline.agents.filter((agent) => agent.status === 'pending_init' || agent.status === 'running')
                        .length
                }
            />
        </Box>
    )
}
