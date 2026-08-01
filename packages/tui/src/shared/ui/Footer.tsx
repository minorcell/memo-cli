import { memo } from 'react'
import { Box, Text } from 'ink'

type FooterProps = {
    busy: boolean
    pendingApproval?: boolean
    contextPercent: number
    /** Thinking mode state (toggled with Tab on an empty input). */
    thinkingOn?: boolean
}

export const Footer = memo(function Footer({
    busy,
    pendingApproval = false,
    contextPercent,
    thinkingOn = true,
}: FooterProps) {
    const context = `${contextPercent.toFixed(1)}%`
    const helpText = pendingApproval
        ? 'Approval pending • Enter confirm • Esc deny'
        : 'Enter send • Shift+Enter newline • Tab thinking • Esc Esc cancel • /help'

    return (
        <Box justifyContent="space-between">
            <Box>{busy ? <Text color="yellow">Working...</Text> : <Text color="gray">{helpText}</Text>}</Box>
            <Box>
                <Text color="gray">thinking: {thinkingOn ? 'on' : 'off'}</Text>
                <Text color="gray"> • </Text>
                <Text color="gray">context: {context}</Text>
            </Box>
        </Box>
    )
})
