import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Box, useApp } from 'ink'
import {
    createAgentSession,
    loadMemoConfig,
    writeMemoConfig,
    type AgentSession,
    type AgentSessionDeps,
    type AgentSessionOptions,
    type ChatMessage,
    type InputHistoryEntry,
    type ProviderConfig,
} from '@memo/core'
import type { StepView, SystemMessage, TurnView } from './types'
import { HeaderBar } from './components/layout/HeaderBar'
import { TokenBar } from './components/layout/TokenBar'
import { MainContent } from './components/layout/MainContent'
import { InputPrompt } from './components/layout/InputPrompt'
import { inferToolStatus, formatTokenUsage } from './utils'
import { resolveSlashCommand } from './commands'

export type AppProps = {
    sessionOptions: AgentSessionOptions
    providerName: string
    model: string
    configPath: string
    mcpServerNames: string[]
    cwd: string
    sessionsDir: string
    providers: ProviderConfig[]
}

function createEmptyTurn(index: number): TurnView {
    return { index, userInput: '', steps: [] }
}

export function App({
    sessionOptions,
    providerName,
    model,
    configPath,
    mcpServerNames,
    cwd,
    sessionsDir,
    providers,
}: AppProps) {
    const { exit } = useApp()
    const [currentProvider, setCurrentProvider] = useState(providerName)
    const [currentModel, setCurrentModel] = useState(model)
    const [sessionOptionsState, setSessionOptionsState] = useState<AgentSessionOptions>({
        ...sessionOptions,
        providerName,
    })
    const [session, setSession] = useState<AgentSession | null>(null)
    const [turns, setTurns] = useState<TurnView[]>([])
    const [systemMessages, setSystemMessages] = useState<SystemMessage[]>([])
    const [statusMessage, setStatusMessage] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const currentTurnRef = useRef<number | null>(null)
    const [inputHistory, setInputHistory] = useState<string[]>([])
    const [sessionLogPath, setSessionLogPath] = useState<string | null>(null)
    const [historicalTurns, setHistoricalTurns] = useState<TurnView[]>([])
    const [pendingHistoryMessages, setPendingHistoryMessages] = useState<ChatMessage[] | null>(null)
    const sessionRef = useRef<AgentSession | null>(null)

    const appendSystemMessage = useCallback((title: string, content: string) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
        setSystemMessages((prev) => [...prev, { id, title, content }])
    }, [])

    const updateTurn = useCallback((turnIndex: number, updater: (turn: TurnView) => TurnView) => {
        setTurns((prev) => {
            const next = [...prev]
            let idx = next.findIndex((turn) => turn.index === turnIndex)
            if (idx === -1) {
                next.push(createEmptyTurn(turnIndex))
                idx = next.length - 1
            }
            const existing = next[idx]
            if (!existing) return next
            next[idx] = updater(existing)
            return next
        })
    }, [])

    const deps = useMemo<AgentSessionDeps>(
        () => ({
            onAssistantStep: (chunk: string, step: number) => {
                const turnIndex = currentTurnRef.current
                if (!turnIndex) return
                updateTurn(turnIndex, (turn) => {
                    const steps = turn.steps.slice()
                    while (steps.length <= step) {
                        steps.push({ index: steps.length, assistantText: '' })
                    }
                    const target = steps[step]
                    if (!target) return turn
                    const updated = {
                        ...target,
                        assistantText: target.assistantText + chunk,
                    }
                    steps[step] = updated
                    return { ...turn, steps }
                })
            },
            hooks: {
                onTurnStart: ({ turn, input }) => {
                    currentTurnRef.current = turn
                    updateTurn(turn, (existing) => ({
                        ...existing,
                        index: turn,
                        userInput: input,
                        steps: [],
                        startedAt: Date.now(),
                    }))
                },
                onAction: ({ turn, step, action }) => {
                    updateTurn(turn, (turnState) => {
                        const steps = turnState.steps.slice()
                        while (steps.length <= step) {
                            steps.push({ index: steps.length, assistantText: '' })
                        }
                        const target = steps[step]
                        if (!target) return turnState
                        steps[step] = {
                            ...target,
                            action,
                            toolStatus: 'executing',
                        }
                        return { ...turnState, steps }
                    })
                },
                onObservation: ({ turn, step, observation }) => {
                    updateTurn(turn, (turnState) => {
                        const steps = turnState.steps.slice()
                        while (steps.length <= step) {
                            steps.push({ index: steps.length, assistantText: '' })
                        }
                        const target = steps[step]
                        if (!target) return turnState
                        steps[step] = {
                            ...target,
                            observation,
                            toolStatus: inferToolStatus(observation),
                        }
                        return { ...turnState, steps }
                    })
                },
                onFinal: ({ turn, finalText, status, turnUsage }) => {
                    updateTurn(turn, (turnState) => {
                        const startedAt = turnState.startedAt ?? Date.now()
                        const durationMs = Math.max(0, Date.now() - startedAt)
                        return {
                            ...turnState,
                            finalText,
                            status,
                            tokenUsage: turnUsage,
                            startedAt,
                            durationMs,
                        }
                    })
                    setBusy(false)
                },
            },
        }),
        [updateTurn],
    )

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const prev = sessionRef.current
            if (prev) {
                await prev.close()
            }
            const created = await createAgentSession(deps, sessionOptionsState)
            if (cancelled) {
                await created.close()
                return
            }
            sessionRef.current = created
            setSession(created)
            setSessionLogPath(created.historyFilePath ?? null)
        })()
        return () => {
            cancelled = true
        }
    }, [deps, sessionOptionsState])

    useEffect(() => {
        return () => {
            if (sessionRef.current) {
                void sessionRef.current.close()
            }
        }
    }, [])

    const handleExit = useCallback(async () => {
        if (sessionRef.current) {
            await sessionRef.current.close()
        }
        exit()
    }, [exit])

    const handleClear = useCallback(() => {
        setTurns([])
        setSystemMessages([])
        setStatusMessage(null)
        setHistoricalTurns([])
        setPendingHistoryMessages(null)
    }, [])

    const handleHistorySelect = useCallback(
        async (entry: InputHistoryEntry) => {
            if (!entry.sessionFile) {
                appendSystemMessage('历史记录', '该记录没有可加载的上下文文件。')
                return
            }
            try {
                const raw = await readFile(entry.sessionFile, 'utf8')
                const parsed = parseHistoryLog(raw)
                setHistoricalTurns(parsed.turns)
                setPendingHistoryMessages(parsed.messages)
                setTurns([])
                appendSystemMessage('历史记录已加载', parsed.summary || entry.input)
            } catch (err) {
                appendSystemMessage(
                    '历史记录加载失败',
                    `无法读取 ${entry.sessionFile}: ${(err as Error).message}`,
                )
            }
        },
        [appendSystemMessage],
    )

    const persistCurrentProvider = useCallback(
        async (name: string) => {
            try {
                const loaded = await loadMemoConfig()
                const nextConfig = { ...loaded.config, current_provider: name }
                await writeMemoConfig(loaded.configPath, nextConfig)
            } catch (err) {
                appendSystemMessage('配置保存失败', `未能保存模型选择: ${(err as Error).message}`)
            }
        },
        [appendSystemMessage],
    )

    const handleCancelRun = useCallback(() => {
        if (!busy) return
        session?.cancelCurrentTurn?.()
    }, [busy, session])

    const handleModelSelect = useCallback(
        async (provider: ProviderConfig) => {
            if (provider.name === currentProvider && provider.model === currentModel) {
                appendSystemMessage('模型切换', `已在使用 ${provider.name} (${provider.model})`)
                return
            }
            if (busy) {
                appendSystemMessage('模型切换', '当前正在运行，按 Esc Esc 取消后再切换模型。')
                return
            }
            setStatusMessage(null)
            setTurns([])
            setHistoricalTurns([])
            setPendingHistoryMessages(null)
            currentTurnRef.current = null
            setSession(null)
            setSessionLogPath(null)
            setCurrentProvider(provider.name)
            setCurrentModel(provider.model)
            setSessionOptionsState((prev) => ({
                ...prev,
                sessionId: randomUUID(),
                providerName: provider.name,
            }))
            await persistCurrentProvider(provider.name)
            appendSystemMessage('模型切换', `已切换到 ${provider.name} (${provider.model})`)
        },
        [appendSystemMessage, busy, currentModel, currentProvider, persistCurrentProvider],
    )

    const handleCommand = useCallback(
        async (raw: string) => {
            const result = resolveSlashCommand(raw, {
                configPath,
                providerName: currentProvider,
                model: currentModel,
                mcpServerNames,
                providers,
            })
            if (result.kind === 'exit') {
                await handleExit()
                return
            }
            if (result.kind === 'clear') {
                handleClear()
                return
            }
            if (result.kind === 'switch_model') {
                await handleModelSelect(result.provider)
                return
            }
            appendSystemMessage(result.title, result.content)
        },
        [
            appendSystemMessage,
            configPath,
            handleClear,
            handleExit,
            handleModelSelect,
            mcpServerNames,
            currentModel,
            currentProvider,
            providers,
        ],
    )

    const handleSubmit = useCallback(
        async (value: string) => {
            if (!session || busy) return
            setStatusMessage(null)
            if (value.startsWith('/')) {
                await handleCommand(value)
                return
            }
            setInputHistory((prev) => [...prev, value])
            if (pendingHistoryMessages?.length && session) {
                session.history.push(...pendingHistoryMessages)
                setPendingHistoryMessages(null)
            }
            setBusy(true)
            try {
                await session.runTurn(value)
            } catch (err) {
                setStatusMessage(`Failed: ${(err as Error).message}`)
                setBusy(false)
            }
        },
        [busy, handleCommand, session, pendingHistoryMessages],
    )

    const lastTurn = turns[turns.length - 1]
    const statusLine =
        statusMessage ?? (!session ? 'Initializing...' : busy ? 'Running' : 'Ready')
    const statusKind =
        statusMessage !== null ? 'error' : !session ? 'initializing' : busy ? 'running' : 'ready'
    const tokenLine = formatTokenUsage(lastTurn?.tokenUsage)

    const displayTurns = useMemo(() => [...historicalTurns, ...turns], [historicalTurns, turns])

    return (
        <Box flexDirection="column" gap={1}>
            <HeaderBar providerName={currentProvider} model={currentModel} cwd={cwd} />
            <MainContent
                systemMessages={systemMessages}
                turns={displayTurns}
                statusText={statusLine}
                statusKind={statusKind}
            />
            <InputPrompt
                disabled={!session || busy}
                onSubmit={handleSubmit}
                onExit={handleExit}
                onClear={handleClear}
                onCancelRun={handleCancelRun}
                onHistorySelect={handleHistorySelect}
                onModelSelect={handleModelSelect}
                history={inputHistory}
                cwd={cwd}
                sessionsDir={sessionsDir}
                currentSessionFile={sessionLogPath ?? undefined}
                providers={providers}
            />
            <TokenBar tokenLine={tokenLine} />
        </Box>
    )
}

function parseHistoryLog(raw: string): {
    summary: string
    messages: ChatMessage[]
    turns: TurnView[]
} {
    const messages: ChatMessage[] = []
    const turns: TurnView[] = []
    const summaryParts: string[] = []
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean)
    let currentTurn: TurnView | null = null
    let turnCount = 0

    for (const line of lines) {
        let event: any
        try {
            event = JSON.parse(line)
        } catch {
            continue
        }
        if (!event || typeof event !== 'object') continue
        if (event.type === 'turn_start') {
            const userInput = typeof event.content === 'string' ? event.content : ''
            const index = -(turnCount + 1)
            currentTurn = {
                index,
                userInput,
                steps: [],
                status: 'ok',
            }
            turns.push(currentTurn)
            if (userInput) {
                messages.push({ role: 'user', content: userInput })
                summaryParts.push(`User: ${userInput}`)
            }
            turnCount += 1
            continue
        }
        if (event.type === 'assistant') {
            const assistantText = typeof event.content === 'string' ? event.content : ''
            if (assistantText) {
                messages.push({ role: 'assistant', content: assistantText })
                summaryParts.push(`Assistant: ${assistantText}`)
                if (currentTurn) {
                    const step: StepView = {
                        index: currentTurn.steps.length,
                        assistantText,
                    }
                    currentTurn.steps = [...currentTurn.steps, step]
                    currentTurn.finalText = assistantText
                }
            }
            continue
        }
    }

    return {
        summary: summaryParts.join('\n'),
        messages,
        turns,
    }
}
