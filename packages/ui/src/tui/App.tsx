import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, useApp } from 'ink'
import {
    createAgentSession,
    type AgentSession,
    type AgentSessionDeps,
    type AgentSessionOptions,
} from '@memo/core'
import type { SystemMessage, TurnView } from './types'
import { HeaderBar } from './components/HeaderBar'
import { TokenBar } from './components/TokenBar'
import { MainContent } from './components/MainContent'
import { InputPrompt } from './components/InputPrompt'
import { inferToolStatus, formatTokenUsage } from './utils'
import { resolveSlashCommand } from './commands'

export type AppProps = {
    sessionOptions: AgentSessionOptions
    providerName: string
    model: string
    streamOutput: boolean
    configPath: string
    mcpServerNames: string[]
}

function createEmptyTurn(index: number): TurnView {
    return { index, userInput: '', steps: [] }
}

export function App({
    sessionOptions,
    providerName,
    model,
    streamOutput,
    configPath,
    mcpServerNames,
}: AppProps) {
    const { exit } = useApp()
    const [session, setSession] = useState<AgentSession | null>(null)
    const [turns, setTurns] = useState<TurnView[]>([])
    const [systemMessages, setSystemMessages] = useState<SystemMessage[]>([])
    const [statusMessage, setStatusMessage] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const currentTurnRef = useRef<number | null>(null)
    const [inputHistory, setInputHistory] = useState<string[]>([])

    const appendSystemMessage = useCallback((title: string, content: string) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
        setSystemMessages((prev) => [...prev, { id, title, content }])
    }, [])

    const updateTurn = useCallback(
        (turnIndex: number, updater: (turn: TurnView) => TurnView) => {
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
        },
        [],
    )

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
                    updateTurn(turn, (turnState) => ({
                        ...turnState,
                        finalText,
                        status,
                        tokenUsage: turnUsage,
                    }))
                    setBusy(false)
                },
            },
        }),
        [updateTurn],
    )

    useEffect(() => {
        let active = true
        ;(async () => {
            const created = await createAgentSession(deps, sessionOptions)
            if (!active) {
                await created.close()
                return
            }
            setSession(created)
        })()
        return () => {
            active = false
        }
    }, [deps, sessionOptions])

    useEffect(() => {
        return () => {
            if (session) {
                void session.close()
            }
        }
    }, [session])

    const handleExit = useCallback(async () => {
        if (session) {
            await session.close()
        }
        exit()
    }, [exit, session])

    const handleClear = useCallback(() => {
        setTurns([])
        setSystemMessages([])
        setStatusMessage(null)
    }, [])

    const handleCommand = useCallback(
        async (raw: string) => {
            const result = resolveSlashCommand(raw, {
                configPath,
                providerName,
                model,
                mcpServerNames,
            })
            if (result.kind === 'exit') {
                await handleExit()
                return
            }
            if (result.kind === 'clear') {
                handleClear()
                return
            }
            appendSystemMessage(result.title, result.content)
        },
        [
            appendSystemMessage,
            configPath,
            handleClear,
            handleExit,
            mcpServerNames,
            model,
            providerName,
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
            setBusy(true)
            try {
                await session.runTurn(value)
            } catch (err) {
                setStatusMessage(`Failed: ${(err as Error).message}`)
                setBusy(false)
            }
        },
        [busy, handleCommand, session],
    )

    const lastTurn = turns[turns.length - 1]
    const statusLine =
        statusMessage ?? (!session ? 'Initializing...' : busy ? 'Running' : 'Ready')
    const statusKind =
        statusMessage !== null
            ? 'error'
            : !session
              ? 'initializing'
              : busy
                ? 'running'
                : 'ready'
    const tokenLine = formatTokenUsage(lastTurn?.tokenUsage)

    return (
        <Box flexDirection="column" gap={1}>
            <HeaderBar
                sessionId={sessionOptions.sessionId ?? '-'}
                providerName={providerName}
                model={model}
                streamOutput={streamOutput}
            />
            <MainContent
                systemMessages={systemMessages}
                turns={turns}
                statusText={statusLine}
                statusKind={statusKind}
            />
            <InputPrompt
                disabled={!session || busy}
                onSubmit={handleSubmit}
                onExit={handleExit}
                onClear={handleClear}
                history={inputHistory}
            />
            <TokenBar tokenLine={tokenLine} />
        </Box>
    )
}
