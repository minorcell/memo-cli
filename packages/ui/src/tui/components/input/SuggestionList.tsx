import { Box, Text } from 'ink'

export type SuggestionListItem = {
    id: string
    title: string
    subtitle?: string
    kind: 'file' | 'history' | 'slash' | 'model'
    badge?: string
}

type SuggestionListProps = {
    items: SuggestionListItem[]
    activeIndex: number
    loading: boolean
}

const ACTIVE_COLOR = '#4ec9ff'
const INACTIVE_COLOR = '#f0f0f0'
const SUBTITLE_COLOR = '#a0a0a0'
const EMPTY_COLOR = '#666666'
const SLASH_DESC_COLOR = '#dadada'

export function SuggestionList({ items, activeIndex, loading }: SuggestionListProps) {
    if (loading) {
        return (
            <Box flexDirection="column">
                <Text color={ACTIVE_COLOR}>加载中...</Text>
            </Box>
        )
    }
    if (!items.length) {
        return (
            <Box flexDirection="column">
                <Text color={EMPTY_COLOR}>无匹配项</Text>
            </Box>
        )
    }
    return (
        <Box flexDirection="column" gap={0}>
            {items.map((item, index) => {
                const isActive = index === activeIndex
                if (item.kind === 'slash') {
                    const commandColor = isActive ? ACTIVE_COLOR : INACTIVE_COLOR
                    const descColor = isActive ? SLASH_DESC_COLOR : SUBTITLE_COLOR
                    return (
                        <Box key={item.id} flexDirection="row" gap={2}>
                            <Text color={commandColor}>{item.title}</Text>
                            {item.subtitle ? <Text color={descColor}>{item.subtitle}</Text> : null}
                        </Box>
                    )
                }
                const titleColor = isActive ? ACTIVE_COLOR : INACTIVE_COLOR
                return (
                    <Box key={item.id} flexDirection="column">
                        <Text color={titleColor}>{item.title}</Text>
                        {item.subtitle ? <Text color={SUBTITLE_COLOR}>{item.subtitle}</Text> : null}
                    </Box>
                )
            })}
        </Box>
    )
}
