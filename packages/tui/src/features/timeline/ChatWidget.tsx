import { memo, useMemo } from 'react'
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

export const ChatWidget = memo(function ChatWidget({
    header,
    systemMessages,
    turns,
    historicalTurns,
}: ChatWidgetProps) {
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

    return (
        <Box flexDirection="column">
            <Static items={staticItems}>
                {(item) => {
                    if (isHeaderItem(item)) {
                        return (
                            <Box key={`header-${item.data.sessionId}`} flexDirection="column">
                                <Box justifyContent="space-between">
                                    <Text bold color="cyan">
                                        Memo Code
                                    </Text>
                                    <Text color="gray">v{item.data.version}</Text>
                                </Box>
                                <Text color="gray" wrap="truncate-end">
                                    {item.data.providerName} / {item.data.model} · {item.data.cwd}
                                </Text>
                                <Text color="gray" wrap="truncate-end">
                                    MCP {item.data.mcpNames.join(', ') || 'none'}
                                </Text>
                            </Box>
                        )
                    }

                    if (isSystemItem(item)) {
                        return <SystemCell key={item.id} message={item} />
                    }

                    return <TurnCell key={`turn-${item.sequence ?? item.index}`} turn={item} cwd={header.cwd} />
                }}
            </Static>

            {inProgressTurn ? <TurnCell turn={inProgressTurn} cwd={header.cwd} /> : null}
        </Box>
    )
})
