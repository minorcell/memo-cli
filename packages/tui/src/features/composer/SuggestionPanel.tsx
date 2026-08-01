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
const INACTIVE_BG = '#262626'

export const SuggestionPanel = memo(function SuggestionPanel({ items, activeIndex, loading }: SuggestionPanelProps) {
    if (loading) {
        return (
            <Box paddingX={1} backgroundColor={INACTIVE_BG}>
                <Text color="gray">Loading...</Text>
            </Box>
        )
    }

    if (!items.length) {
        return (
            <Box paddingX={1} backgroundColor={INACTIVE_BG}>
                <Text color="gray">No matches</Text>
            </Box>
        )
    }

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" backgroundColor={INACTIVE_BG}>
            {items.map((item, index) => {
                const active = index === activeIndex
                return (
                    <Box key={item.id} paddingX={1} gap={2} backgroundColor={active ? ACTIVE_BG : INACTIVE_BG}>
                        <Text color={active ? 'cyan' : 'white'} bold={active}>
                            {item.title}
                        </Text>
                        {item.subtitle ? <Text color="gray">{item.subtitle}</Text> : null}
                    </Box>
                )
            })}
        </Box>
    )
})
