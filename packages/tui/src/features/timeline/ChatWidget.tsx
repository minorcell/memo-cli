import { memo, useMemo, type ReactNode } from 'react'
import { Box, Static, Text, useStdout } from 'ink'
import stringWidth from 'string-width'
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

const HEADER_MAX_LINE_WIDTH = 56

function truncateHeaderText(text: string, maxWidth: number): string {
    if (stringWidth(text) <= maxWidth) return text
    let out = ''
    let used = 0
    for (const ch of text) {
        const charWidth = stringWidth(ch)
        if (used + charWidth > maxWidth - 1) break
        out += ch
        used += charWidth
    }
    return `${out}…`
}

function HeaderLabel({ children }: { children: ReactNode }) {
    return (
        <Text color="gray" dimColor>
            {children}
        </Text>
    )
}

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

    const { stdout } = useStdout()
    const terminalWidth = stdout?.columns ?? process.stdout?.columns ?? 80
    const lineWidth = Math.min(HEADER_MAX_LINE_WIDTH, Math.max(24, terminalWidth - 12))

    return (
        <Box flexDirection="column">
            <Static items={staticItems}>
                {(item) => {
                    if (isHeaderItem(item)) {
                        const data = item.data
                        return (
                            <Box
                                key={`header-${data.sessionId}`}
                                flexDirection="column"
                                borderStyle="round"
                                borderColor="cyan"
                                borderDimColor
                                paddingX={1}
                                marginBottom={1}
                            >
                                <Text>
                                    <Text bold color="cyan">
                                        ›●{' '}
                                    </Text>
                                    <Text bold>Memo Code</Text>
                                    <Text color="gray"> v{data.version}</Text>
                                </Text>
                                <Text wrap="truncate-end">
                                    <HeaderLabel>provider: </HeaderLabel>
                                    <Text>
                                        {data.providerName} / {data.model}
                                    </Text>
                                    <HeaderLabel> /models to change</HeaderLabel>
                                </Text>
                                <Text wrap="truncate-end">
                                    <HeaderLabel>directory: </HeaderLabel>
                                    <Text>{truncateHeaderText(data.cwd, lineWidth)}</Text>
                                </Text>
                                {data.mcpNames.length > 0 ? (
                                    <Text wrap="truncate-end">
                                        <HeaderLabel>MCP: </HeaderLabel>
                                        <Text>{data.mcpNames.join(', ')}</Text>
                                    </Text>
                                ) : null}
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
