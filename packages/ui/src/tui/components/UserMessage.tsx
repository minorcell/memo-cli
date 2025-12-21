import { Box, Text, useStdout } from 'ink'
import { USER_PREFIX } from '../constants'
import { buildPaddedLine } from '../utils'

type UserMessageProps = {
    text: string
}

export function UserMessage({ text }: UserMessageProps) {
    const { stdout } = useStdout()
    const terminalWidth = stdout?.columns ?? 80
    const verticalPadding = 1
    const { line, blankLine } = buildPaddedLine(`${USER_PREFIX} ${text}`, terminalWidth, 1)

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
