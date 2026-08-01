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
    type AgentSession,
    type AgentSessionDeps,
    type AgentSessionOptions,
    type ChatMessage,
    type MCPServerConfig,
    type ModelProfileOverride,
    type ProviderConfig,
} from '@memo/core'
import { useApproval } from './hooks/useApproval'
import { ChatWidget } from '../features/timeline/ChatWidget'
import { Composer } from '../features/composer/Composer'
import { Footer } from '../shared/ui/Footer'
import { ApprovalOverlay } from '../features/approval/ApprovalOverlay'
import { McpActivationOverlay } from '../features/mcp/McpActivationOverlay'
import { notifyApprovalRequested } from '../features/approval/approvalNotification'
import { SetupWizard } from '../features/setup/SetupWizard'
import { parseHistoryLog } from '../features/session/historyParser'
import { chatTimelineReducer, createInitialTimelineState } from '../features/timeline/chatTimeline'
import { calculateContextPercent, inferParallelToolStatuses, inferToolStatus } from '../shared/lib/utils'
import { checkForUpdate, findLocalPackageInfoSync } from '../shared/lib/version'
import type { SessionHistoryEntry } from '../features/session/sessionHistory'
import { loadTaskPrompt } from '../shared/lib/taskPrompt'
import { resolveReviewBackend } from '../features/review/backend'
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

    const [currentProvider, setCurrentProvider] = useState(providerName)
    const [currentModel, setCurrentModel] = useState(model)
    const [providersState, setProvidersState] = useState(providers)
    const [modelProfilesState, setModelProfilesState] = useState(modelProfiles)
    const [toolPermissionMode, setToolPermissionMode] = useState<ToolPermissionMode>(defaultToolPermissionMode)
    const [thinkingOn, setThinkingOn] = useState<boolean>(() => {
        const override = modelProfilesState?.[model] ?? modelProfilesState?.[`${providerName}:${model}`]
        return override?.supports_reasoning_content ?? true
    })

    const resolveContextLimit = useCallback(
        (providerConfig: Pick<ProviderConfig, 'name' | 'model'>) =>
            resolveContextWindowForProvider({ model_profiles: modelProfilesState }, providerConfig),
        [modelProfilesState],
    )

    const [sessionOptionsState, setSessionOptionsState] = useState<AgentSessionOptions>({
        ...sessionOptions,
        providerName,
        contextWindow: resolveContextLimit({ name: providerName, model }),
        dangerous: defaultToolPermissionMode === TOOL_PERMISSION_MODES.FULL,
        toolPermissionMode: defaultToolPermissionMode,
    })

    const [inputHistory, setInputHistory] = useState<string[]>([])

    const [contextLimit, setContextLimit] = useState<number>(resolveContextLimit({ name: providerName, model }))
    const [currentContextTokens, setCurrentContextTokens] = useState(0)

    const [setupPending, setSetupPending] = useState(needsSetup)
    const [mcpSelectionPending, setMcpSelectionPending] = useState(!needsSetup && availableMcpServerNames.length > 0)
    const [activeMcpServerNames, setActiveMcpServerNames] = useState<string[]>(initialActiveMcpServers)
    const [exitMessage, setExitMessage] = useState<string | null>(null)

    const [busy, setBusy] = useState(false)
    const [sessionLogPath, setSessionLogPath] = useState<string | null>(null)
    const [pendingHistoryMessages, setPendingHistoryMessages] = useState<ChatMessage[] | null>(null)
    const [session, setSession] = useState<AgentSession | null>(null)
    const sessionRef = useRef<AgentSession | null>(null)
    const currentTurnRef = useRef<number | null>(null)
    const nextUserInputOverrideRef = useRef<string | null>(null)

    const { pendingApproval, setPendingApproval, approvalResolverRef, handleApprovalDecision } = useApproval()

    const handleToggleThinking = useCallback(() => {
        setThinkingOn((prev) => {
            const next = !prev
            sessionRef.current?.setThinking?.(next)
            return next
        })
    }, [])

    const localPackageInfo = useMemo(() => findLocalPackageInfoSync(), [])

    useEffect(() => {
        if (!initialHistory) return
        dispatchTimeline({ type: 'clear_current_timeline' })
        dispatchTimeline({
            type: 'replace_history',
            turns: initialHistory.turns,
            maxSequence: initialHistory.maxSequence,
        })
        setPendingHistoryMessages(initialHistory.messages)
        if (initialHistory.summary.trim()) {
            dispatchTimeline({
                type: 'append_system_message',
                title: 'History',
                content: initialHistory.summary,
                tone: 'info',
            })
        }
    }, [dispatchTimeline, initialHistory])

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
            onAssistantStep: (chunk: string, step: number) => {
                const turn = currentTurnRef.current
                if (!turn) return
                dispatchTimeline({ type: 'assistant_chunk', turn, step, chunk })
            },
            requestApproval:
                toolPermissionMode === TOOL_PERMISSION_MODES.FULL || toolPermissionMode === TOOL_PERMISSION_MODES.NONE
                    ? undefined
                    : (request) =>
                          new Promise((resolve) => {
                              void notifyApprovalRequested(request)
                              setPendingApproval(request)
                              approvalResolverRef.current = resolve
                          }),
            hooks: {
                onTurnStart: ({ turn, input, promptTokens }) => {
                    currentTurnRef.current = turn
                    const override = nextUserInputOverrideRef.current
                    if (override) {
                        nextUserInputOverrideRef.current = null
                    }
                    const displayInput = override ?? input

                    if (promptTokens && promptTokens > 0) {
                        setCurrentContextTokens(promptTokens)
                    }

                    dispatchTimeline({
                        type: 'turn_start',
                        turn,
                        input: displayInput,
                        promptTokens,
                    })
                },
                onContextUsage: ({ turn, step, promptTokens, phase }) => {
                    setCurrentContextTokens(promptTokens)
                    dispatchTimeline({
                        type: 'context_usage',
                        turn,
                        step,
                        promptTokens,
                        phase,
                    })
                },
                onContextCompacted: ({ reason, status, beforeTokens, afterTokens, reductionPercent, errorMessage }) => {
                    if (status === 'success') {
                        setCurrentContextTokens(afterTokens)
                    }
                    const compactedBy = reason === 'manual' ? 'manual command' : 'auto trigger'
                    if (status === 'success') {
                        appendSystemMessage(
                            'Context compacted',
                            `Compacted by ${compactedBy}: ${beforeTokens} -> ${afterTokens} tokens (${reductionPercent.toFixed(2)}% reduced).`,
                        )
                        return
                    }
                    if (status === 'skipped') {
                        appendSystemMessage(
                            'Context compacted',
                            `Skipped (${compactedBy}): nothing to compact.`,
                            'warning',
                        )
                        return
                    }
                    appendSystemMessage(
                        'Context compacted',
                        `Failed (${compactedBy}): ${errorMessage ?? 'unknown error'}`,
                        'warning',
                    )
                },
                onAction: ({ turn, step, action, thinking, parallelActions }) => {
                    dispatchTimeline({
                        type: 'tool_action',
                        turn,
                        step,
                        action,
                        thinking,
                        parallelActions,
                    })
                },
                onObservation: ({ turn, step, observation, resultStatus, parallelResultStatuses }) => {
                    dispatchTimeline({
                        type: 'tool_observation',
                        turn,
                        step,
                        observation,
                        toolStatus: inferToolStatus(resultStatus),
                        parallelToolStatuses: inferParallelToolStatuses(parallelResultStatuses),
                    })
                },
                onFinal: ({ turn, finalText, status, errorMessage, turnUsage, tokenUsage, thinking }) => {
                    dispatchTimeline({
                        type: 'turn_final',
                        turn,
                        finalText,
                        status,
                        errorMessage,
                        turnUsage,
                        tokenUsage,
                        thinking,
                    })
                    setBusy(false)
                },
            },
        }),
        [appendSystemMessage, dispatchTimeline, toolPermissionMode],
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

                const created = await createAgentSession(deps, sessionOptionsState)
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
                setBusy(false)
                appendSystemMessage('Session', `Failed to create session: ${(err as Error).message}`, 'error')
            }
        })()

        return () => {
            cancelled = true
        }
    }, [appendSystemMessage, deps, mcpSelectionPending, sessionOptionsState, setupPending])

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
        const resolver = approvalResolverRef.current
        if (resolver) {
            resolver('deny')
            approvalResolverRef.current = null
        }
        if (pendingApproval) {
            setPendingApproval(null)
        }
        if (sessionRef.current) {
            await sessionRef.current.close()
        }
        setExitMessage('Bye!')
    }, [pendingApproval])

    // Render the farewell message first, then unmount.
    useEffect(() => {
        if (exitMessage) {
            exit()
        }
    }, [exit, exitMessage])

    const guardBusyOrApproval = useCallback(
        (action: string): boolean => {
            if (busy) {
                appendSystemMessage(action, 'Cancel current run before proceeding.', 'warning')
                return true
            }
            if (pendingApproval) {
                appendSystemMessage(action, 'Resolve current approval request before proceeding.', 'warning')
                return true
            }
            return false
        },
        [appendSystemMessage, busy, pendingApproval],
    )

    const handleClear = useCallback(() => {
        if (guardBusyOrApproval('Clear')) return
        dispatchTimeline({ type: 'clear_current_timeline' })
        setPendingHistoryMessages(null)
        setCurrentContextTokens(0)
        clearTerminalScreen()
    }, [dispatchTimeline, guardBusyOrApproval])

    const handleNewSession = useCallback(() => {
        if (guardBusyOrApproval('New Session')) return
        dispatchTimeline({ type: 'reset_all' })
        setPendingHistoryMessages(null)
        setCurrentContextTokens(0)
        currentTurnRef.current = null
        setSessionOptionsState((prev) => ({
            ...prev,
            sessionId: randomUUID(),
        }))
        appendSystemMessage('New Session', 'Started a fresh session.')
    }, [appendSystemMessage, dispatchTimeline, guardBusyOrApproval])

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
            if (guardBusyOrApproval('Model switch')) return

            if (provider.name === currentProvider && provider.model === currentModel) {
                appendSystemMessage('Model switch', `Already using ${provider.name} (${provider.model}).`)
                return
            }

            dispatchTimeline({ type: 'reset_all' })
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
            guardBusyOrApproval,
            persistCurrentProvider,
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
            if (guardBusyOrApproval('Tools')) return

            if (mode === toolPermissionMode) {
                appendSystemMessage('Tools', `Already using ${toolPermissionLabel(mode)}.`)
                return
            }

            // Tool permission is baked into the session at creation time, so
            // switching modes recreates the session; reset the visible timeline
            // to match the fresh session's (empty) history.
            setToolPermissionMode(mode)
            dispatchTimeline({ type: 'reset_all' })
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
        [appendSystemMessage, dispatchTimeline, guardBusyOrApproval, toolPermissionLabel, toolPermissionMode],
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
            if (guardBusyOrApproval('History')) return
            try {
                const raw = await readFile(entry.sessionFile, 'utf8')
                const parsed = parseHistoryLog(raw)
                dispatchTimeline({ type: 'clear_current_timeline' })
                dispatchTimeline({
                    type: 'replace_history',
                    turns: parsed.turns,
                    maxSequence: parsed.maxSequence,
                })
                setPendingHistoryMessages(parsed.messages)
                setBusy(false)
                setSession(null)
                setSessionLogPath(null)
                setCurrentContextTokens(0)
                currentTurnRef.current = null
                setSessionOptionsState((prev) => ({ ...prev, sessionId: randomUUID() }))
                appendSystemMessage('History', parsed.summary || entry.input)
            } catch (err) {
                appendSystemMessage(
                    'History',
                    `Failed to load ${entry.sessionFile}: ${(err as Error).message}`,
                    'error',
                )
            }
        },
        [appendSystemMessage, dispatchTimeline, guardBusyOrApproval],
    )

    const handleCancelRun = useCallback(() => {
        if (!busy) return
        session?.cancelCurrentTurn?.()
    }, [busy, session])

    const runCompactCommand = useCallback(async () => {
        if (guardBusyOrApproval('Compact')) return
        if (!session) return

        try {
            const result = await session.compactHistory('manual')
            setCurrentContextTokens(result.afterTokens)
        } catch (err) {
            appendSystemMessage('Compact', `Failed to compact context: ${(err as Error).message}`, 'error')
        }
    }, [appendSystemMessage, guardBusyOrApproval, session])

    const runInitCommand = useCallback(async () => {
        if (!session || busy) return

        const initCommand = formatSlashCommand(SLASH_COMMANDS.INIT)
        try {
            const prompt = await loadTaskPrompt('init_agents')
            setInputHistory((prev) => [...prev, initCommand])
            setBusy(true)
            nextUserInputOverrideRef.current = initCommand
            await session.runTurn(prompt)
        } catch (err) {
            setBusy(false)
            appendSystemMessage('Init', `Failed to run init task: ${(err as Error).message}`, 'error')
        }
    }, [appendSystemMessage, busy, session])

    const runReviewPullRequestCommand = useCallback(
        async (prNumber: number) => {
            if (!session || busy) return

            if (toolPermissionMode === TOOL_PERMISSION_MODES.NONE) {
                appendSystemMessage(
                    'Review',
                    'Tool permission mode is "none". Set `/tools once` or `/tools full` before running `/review`.',
                    'warning',
                )
                return
            }

            const reviewCommand = `${formatSlashCommand(SLASH_COMMANDS.REVIEW)} ${prNumber}`
            try {
                const backend = await resolveReviewBackend({
                    cwd,
                    mcpServers,
                    activeMcpServerNames,
                    availableToolNames: session.listToolNames?.() ?? [],
                })

                if (backend.kind === 'unavailable') {
                    appendSystemMessage('Review', backend.reason, 'error')
                    return
                }

                const prompt = await loadTaskPrompt('review_pull_request', {
                    pr_number: String(prNumber),
                    backend_strategy: backend.strategy,
                    backend_details: backend.details,
                    mcp_server_prefix: backend.kind === 'github_mcp' ? backend.mcpServerPrefix : 'github',
                })

                setInputHistory((prev) => [...prev, reviewCommand])
                appendSystemMessage('Review', backend.details)
                setBusy(true)
                nextUserInputOverrideRef.current = reviewCommand
                await session.runTurn(prompt)
            } catch (err) {
                setBusy(false)
                appendSystemMessage(
                    'Review',
                    `Failed to run review task for PR #${prNumber}: ${(err as Error).message}`,
                    'error',
                )
            }
        },
        [activeMcpServerNames, appendSystemMessage, busy, cwd, mcpServers, session, toolPermissionMode],
    )

    const handleSubmit = useCallback(
        async (value: string) => {
            const trimmed = value.trim()
            if (!trimmed) return

            if (trimmed.toLowerCase() === PLAIN_EXIT_COMMAND) {
                await handleExit()
                return
            }

            if (trimmed === formatSlashCommand(SLASH_COMMANDS.INIT)) {
                await runInitCommand()
                return
            }

            if (!session || busy) return

            setInputHistory((prev) => [...prev, trimmed])
            setBusy(true)
            try {
                await session.runTurn(trimmed)
            } catch (err) {
                setBusy(false)
                appendSystemMessage('Run', `Turn failed: ${(err as Error).message}`, 'error')
            }
        },
        [appendSystemMessage, busy, handleExit, runInitCommand, session],
    )

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
            />

            <Composer
                disabled={!session || !!pendingApproval}
                busy={busy}
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
                onHistorySelect={(entry) => {
                    void handleHistorySelect(entry)
                }}
                onModelSelect={(provider) => {
                    void handleModelSelect(provider)
                }}
                onSetToolPermission={handleSetToolPermission}
                onReviewPullRequest={(prNumber) => {
                    void runReviewPullRequestCommand(prNumber)
                }}
                onSystemMessage={appendSystemMessage}
            />

            {pendingApproval ? <ApprovalOverlay request={pendingApproval} onDecision={handleApprovalDecision} /> : null}

            <Footer
                busy={busy}
                pendingApproval={Boolean(pendingApproval)}
                contextPercent={contextPercent}
                thinkingOn={thinkingOn}
            />
        </Box>
    )
}
