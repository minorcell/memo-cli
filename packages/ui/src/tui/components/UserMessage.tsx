import { Box, Text, useStdout } from 'ink'
import stringWidth from 'string-width'
import { USER_PREFIX } from '../constants'

type UserMessageProps = {
    text: string
}

export function UserMessage({ text }: UserMessageProps) {
    const { stdout } = useStdout()
    const terminalWidth = stdout?.columns ?? 80
    const horizontalPadding = 1
    const verticalPadding = 1
    const content = `${' '.repeat(horizontalPadding)}${USER_PREFIX} ${text}${' '.repeat(
        horizontalPadding,
    )}`
    const width = Math.max(1, terminalWidth)
    const padding = Math.max(0, width - stringWidth(content))
    const line = padding > 0 ? `${content}${' '.repeat(padding)}` : content
    const blankLine = ' '.repeat(width)

    return (
        <Box flexDirection="column">
            {verticalPadding > 0 ? (
                <Text backgroundColor="#2b2b2b">{blankLine}</Text>
            ) : null}
            <Text color="white" backgroundColor="#2b2b2b">
                {line}
            </Text>
            {verticalPadding > 0 ? (
                <Text backgroundColor="#2b2b2b">{blankLine}</Text>
            ) : null}
        </Box>
    )
}
