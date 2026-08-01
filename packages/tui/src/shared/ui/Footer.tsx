import { memo } from 'react'
import { Box, Text, useStdout } from 'ink'
import type { RuntimeStatus } from '../types'

type FooterProps = {
    operationStatus: RuntimeStatus
    queuedCount?: number
    contextPercent: number
    /** Thinking mode state (toggled with Tab on an empty input). */
    thinkingOn?: boolean
}

export const Footer = memo(function Footer({
    operationStatus,
    queuedCount = 0,
    contextPercent,
    thinkingOn = true,
}: FooterProps) {
    const { stdout } = useStdout()
    const compact = (stdout.columns ?? 80) < 72
    const context = `${contextPercent.toFixed(1)}%`
    const statusText =
        operationStatus === 'running'
            ? 'Running...'
            : operationStatus === 'awaiting_approval'
              ? compact
                  ? 'Approval pending'
                  : 'Waiting for approval...'
              : operationStatus === 'cancelling'
                ? 'Cancelling...'
                : operationStatus === 'compacting'
                  ? compact
                      ? 'Compacting...'
                      : 'Compacting context...'
                  : compact
                    ? 'Enter send • /help'
                    : 'Enter send • Shift+Enter newline • Tab thinking • Esc×2 cancel • /help'
    const metrics =
        compact && queuedCount > 0
            ? `ctx:${Math.round(contextPercent)}%`
            : compact
              ? `think:${thinkingOn ? 'on' : 'off'} • ctx:${context}`
              : `thinking: ${thinkingOn ? 'on' : 'off'} • context: ${context}`
    const queueText = queuedCount > 0 ? `${queuedCount} queued` : null

    return (
        <Box justifyContent="space-between">
            <Box flexShrink={1}>
                <Text color={operationStatus === 'idle' ? 'gray' : 'yellow'} wrap="truncate-end">
                    {compact && queueText ? <Text color="cyan">[{queueText}] </Text> : null}
                    {statusText}
                    {!compact && queueText ? <Text color="cyan"> • {queueText}</Text> : null}
                </Text>
            </Box>
            <Box flexShrink={0} marginLeft={1}>
                <Text color="gray">{metrics}</Text>
            </Box>
        </Box>
    )
})
