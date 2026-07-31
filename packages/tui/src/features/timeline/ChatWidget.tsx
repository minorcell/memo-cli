import { memo, useMemo, useRef, useEffect } from 'react'
import { Box, Static, Text } from 'ink'
import type { SystemMessage, TurnView } from '../../shared/types'
import { SystemCell, TurnCell } from './Cells'

type HeaderInfo = {
    providerName: string
    model: string
    cwd: string
    sessionId: string
    mcpNames: string[]
    version: string
}

type ChatWidgetProps = {
    header: HeaderInfo
    systemMessages: SystemMessage[]
    turns: TurnView[]
    historicalTurns: TurnView[]
}

type HeaderStaticItem = { type: 'header'; data: HeaderInfo }
type HistoryStaticItem = SystemMessage | TurnView
type StaticItem = HeaderStaticItem | HistoryStaticItem

function itemSequence(item: HistoryStaticItem): number {
    return item.sequence ?? 0
}

function isHeaderItem(item: StaticItem): item is HeaderStaticItem {
    return (item as HeaderStaticItem).type === 'header'
}

function isSystemItem(item: HistoryStaticItem): item is SystemMessage {
    return (item as SystemMessage).id !== undefined
}

// Stable header key helper to minimize Static re-renders
function useStableHeaderKey(header: HeaderInfo): string {
    const prevKeyRef = useRef<string>('')
    return useMemo(() => {
        const newKey = `${header.sessionId}-${header.providerName}-${header.model}-${header.version}`
        // Only update if session actually changed
        if (newKey !== prevKeyRef.current) {
            prevKeyRef.current = newKey
        }
        return prevKeyRef.current
    }, [header.sessionId, header.providerName, header.model, header.version])
}

export const ChatWidget = memo(function ChatWidget({
    header,
    systemMessages,
    turns,
    historicalTurns,
}: ChatWidgetProps) {
    // Use stable keys to minimize re-renders of Static items
    const stableHeaderKey = useStableHeaderKey(header)
    const cwdRef = useRef(header.cwd)
    useEffect(() => {
        cwdRef.current = header.cwd
    }, [header.cwd])

    const { inProgressTurn, staticItems } = useMemo(() => {
        const allTurns = [...historicalTurns, ...turns]
        const lastTurn = allTurns.length > 0 ? allTurns[allTurns.length - 1] : undefined
        const lastTurnComplete =
            lastTurn && Boolean(lastTurn.finalText || (lastTurn.status && lastTurn.status !== 'ok'))

        const completed = lastTurnComplete ? allTurns : allTurns.slice(0, -1)
        const inProgress = lastTurnComplete ? undefined : lastTurn

        const headerItem: HeaderStaticItem = { type: 'header', data: header }

        const historyItems: HistoryStaticItem[] = [...systemMessages, ...completed]
        historyItems.sort((a, b) => itemSequence(a) - itemSequence(b))

        const items: StaticItem[] = [headerItem, ...historyItems]

        return { completedTurns: completed, inProgressTurn: inProgress, staticItems: items }
    }, [header, historicalTurns, turns, systemMessages])

    // Use a stable cwd for TurnCell to avoid re-renders during streaming
    const stableCwd = cwdRef.current

    return (
        <Box flexDirection="column">
            <Static items={staticItems}>
                {(item) => {
                    if (isHeaderItem(item)) {
                        return (
                            <Box
                                key={`header-${stableHeaderKey}`}
                                borderStyle="round"
                                borderColor="blue"
                                paddingX={1}
                                flexDirection="column"
                            >
                                <Text bold>Memo Code</Text>
                                <Text color="gray">
                                    {item.data.providerName} / {item.data.model} • v{item.data.version}
                                </Text>
                                <Text color="gray">cwd: {item.data.cwd}</Text>
                                <Text color="gray">mcp: {item.data.mcpNames.join(', ') || 'none'}</Text>
                            </Box>
                        )
                    }

                    if (isSystemItem(item)) {
                        return <SystemCell key={item.id} message={item} />
                    }

                    return <TurnCell key={`turn-${item.sequence ?? item.index}`} turn={item} cwd={stableCwd} />
                }}
            </Static>

            {inProgressTurn ? <TurnCell turn={inProgressTurn} cwd={stableCwd} /> : null}
        </Box>
    )
})
