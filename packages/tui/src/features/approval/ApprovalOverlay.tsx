import { memo } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { Select, type Option as SelectOption } from '@inkjs/ui'
import type { ApprovalDecision, ApprovalRequest } from '@memo/core'
import { previewText } from '../timeline/contentPreview'

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
    return `${key}=${raw ?? ''}`
}

export const ApprovalOverlay = memo(function ApprovalOverlay({ request, onDecision }: ApprovalOverlayProps) {
    const { stdout } = useStdout()
    // Note: Ctrl+C is handled by Ink's built-in exit, so only Esc is handled here.
    useInput((_input, key) => {
        if (key.escape) {
            onDecision('deny')
        }
    })

    const rawParam = shortParam(request.params)
    const param = rawParam
        ? previewText(rawParam, {
              columns: Math.max(1, (stdout.columns ?? 80) - 4),
              maxLines: 2,
          }).text
        : null

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
            <Box justifyContent="space-between">
                <Text bold color="yellow">
                    Approval required
                </Text>
                <Text color="gray">{request.riskLevel}</Text>
            </Box>
            <Text bold color="cyan">
                {request.toolName}
            </Text>
            {param ? (
                <Text color="gray" dimColor>
                    {param}
                </Text>
            ) : null}
            <Text color="yellow">{request.reason}</Text>
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
