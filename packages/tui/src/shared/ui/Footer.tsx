import { memo } from 'react'
import { Box, Text } from 'ink'

type FooterProps = {
    busy: boolean
    pendingApproval?: boolean
    contextPercent: number
}

export const Footer = memo(function Footer({ busy, pendingApproval = false, contextPercent }: FooterProps) {
    const context = `${contextPercent.toFixed(1)}%`
    const helpText = pendingApproval
        ? 'Approval pending • Enter confirm • Esc deny'
        : 'Enter send • Shift+Enter newline • /help'

    return (
        <Box justifyContent="space-between">
            <Box>{busy ? <Text color="yellow">Working...</Text> : <Text color="gray">{helpText}</Text>}</Box>
            <Text color="gray">context: {context}</Text>
        </Box>
    )
})
