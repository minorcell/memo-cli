import { memo } from 'react'
import { Box, Text, useInput } from 'ink'
import { Select, StatusMessage, type Option as SelectOption } from '@inkjs/ui'
import type { ApprovalDecision, ApprovalRequest } from '@memo/core'

type ApprovalOverlayProps = {
    request: ApprovalRequest
    onDecision: (decision: ApprovalDecision) => void
}

type ApprovalOption = {
    label: string
    decision: ApprovalDecision
}

const DEFAULT_OPTIONS: ApprovalOption[] = [
    { label: 'Allow once', decision: 'once' },
    { label: 'Allow for this session', decision: 'session' },
    { label: 'Deny', decision: 'deny' },
]

function shortParam(params: unknown): string {
    if (!params) return ''
    if (typeof params !== 'object') return String(params)
    const entries = Object.entries(params as Record<string, unknown>)
    if (!entries.length) return ''
    const [key, value] = entries[0] ?? []
    if (!key) return ''
    const raw = typeof value === 'string' ? value : JSON.stringify(value)
    return `${key}=${raw?.slice(0, 60) ?? ''}${raw && raw.length > 60 ? '...' : ''}`
}

export const ApprovalOverlay = memo(function ApprovalOverlay({ request, onDecision }: ApprovalOverlayProps) {
    // Note: Ctrl+C is handled by Ink's built-in exit, so only Esc is handled here.
    useInput((_input, key) => {
        if (key.escape) {
            onDecision('deny')
        }
    })

    const param = shortParam(request.params)

    return (
        <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1}>
            <Text bold color="yellow">
                Tool Approval Required
            </Text>
            <Text>
                {request.toolName}
                {param ? ` (${param})` : ''}
            </Text>
            <Box marginTop={1}>
                <StatusMessage variant="warning">{request.reason}</StatusMessage>
            </Box>
            <Box marginTop={1} flexDirection="column">
                <Select
                    options={DEFAULT_OPTIONS.map(
                        (option): SelectOption => ({
                            label: option.label,
                            value: option.decision,
                        }),
                    )}
                    onChange={(value) => {
                        onDecision(value as ApprovalDecision)
                    }}
                />
            </Box>
            <Box marginTop={1}>
                <Text color="gray">Enter confirm • Esc deny</Text>
            </Box>
        </Box>
    )
})
