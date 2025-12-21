import { Box, Text } from 'ink'
import { PREFIX_GLYPH } from '../constants'

type AssistantMessageProps = {
    text: string
    tone?: 'normal' | 'muted'
}

export function AssistantMessage({ text, tone = 'normal' }: AssistantMessageProps) {
    const prefixColor = tone === 'muted' ? 'gray' : 'white'
    return (
        <Box>
            <Text color={prefixColor}>{PREFIX_GLYPH} </Text>
            <Text color={tone === 'muted' ? 'gray' : undefined}>{text}</Text>
        </Box>
    )
}
