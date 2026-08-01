import { memo } from 'react'
import { Box, Text } from 'ink'

export type SuggestionKind = 'file' | 'history' | 'slash' | 'model' | 'tools'

export type SuggestionItem = {
    id: string
    title: string
    subtitle?: string
    kind: SuggestionKind
}

type SuggestionPanelProps = {
    items: SuggestionItem[]
    activeIndex: number
    loading: boolean
}

const ACTIVE_BG = '#3a3a3a'
const MAX_VISIBLE_ITEMS = 8

function kindLabel(kind: SuggestionKind): string {
    switch (kind) {
        case 'slash':
            return 'command'
        case 'history':
            return 'history'
        case 'model':
            return 'model'
        case 'tools':
            return 'policy'
        case 'file':
            return 'file'
    }
}

export const SuggestionPanel = memo(function SuggestionPanel({ items, activeIndex, loading }: SuggestionPanelProps) {
    if (loading) {
        return (
            <Box paddingX={1} borderStyle="single" borderColor="gray">
                <Text color="gray">Loading...</Text>
            </Box>
        )
    }

    if (!items.length) {
        return (
            <Box paddingX={1} borderStyle="single" borderColor="gray">
                <Text color="gray">No matches</Text>
            </Box>
        )
    }

    const start = Math.min(
        Math.max(0, activeIndex - MAX_VISIBLE_ITEMS + 1),
        Math.max(0, items.length - MAX_VISIBLE_ITEMS),
    )
    const visibleItems = items.slice(start, start + MAX_VISIBLE_ITEMS)

    return (
        <Box flexDirection="column" borderStyle="single" borderColor="gray">
            {visibleItems.map((item, visibleIndex) => {
                const index = start + visibleIndex
                const active = index === activeIndex
                return (
                    <Box key={item.id} paddingX={1} backgroundColor={active ? ACTIVE_BG : undefined}>
                        <Text wrap="truncate-end">
                            <Text bold color={active ? 'cyan' : 'gray'}>
                                {`${active ? '›' : ' '} ${kindLabel(item.kind).padEnd(8)} `}
                            </Text>
                            <Text bold={active} color={active ? 'white' : undefined}>
                                {item.title}
                            </Text>
                            {item.subtitle ? <Text color="gray"> · {item.subtitle}</Text> : null}
                        </Text>
                    </Box>
                )
            })}
            {items.length > MAX_VISIBLE_ITEMS ? (
                <Box justifyContent="flex-end" paddingX={1}>
                    <Text color="gray">
                        {activeIndex + 1}/{items.length}
                    </Text>
                </Box>
            ) : null}
        </Box>
    )
})
