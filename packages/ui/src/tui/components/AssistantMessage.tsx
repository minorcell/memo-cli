import { Box, Text } from 'ink'
import { ASSISTANT_PREFIX } from '../constants'
import { MarkdownMessage } from './MarkdownMessage'

type AssistantMessageProps = {
    text: string
    tone?: 'normal' | 'muted'
}

export function AssistantMessage({ text, tone = 'normal' }: AssistantMessageProps) {
    const prefixColor = tone === 'muted' ? 'gray' : 'white'
    return (
        <Box alignItems="flex-start">
            <Text color={prefixColor}>{ASSISTANT_PREFIX} </Text>
            <Box flexDirection="column" flexGrow={1}>
                <MarkdownMessage text={text} tone={tone} />
            </Box>
        </Box>
    )
}
