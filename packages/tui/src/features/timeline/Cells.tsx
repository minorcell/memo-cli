import { memo } from 'react'
import { Box, Text } from 'ink'
import { TOOL_STATUS, type SystemMessage, type StepView, type ToolStatus, type TurnView } from '../../shared/types'
import { looksLikePathInput, safeStringify, toRelativeDisplayPath, truncate } from '../../shared/lib/utils'
import { MarkdownRenderer } from './MarkdownRenderer'

function statusColor(status?: ToolStatus): string {
    if (status === TOOL_STATUS.ERROR) return 'red'
    if (status === TOOL_STATUS.EXECUTING) return 'yellow'
    return 'green'
}

function mainParam(input: unknown, cwd: string): string | null {
    if (input === undefined || input === null) return null
    if (typeof input === 'string') {
        const display = looksLikePathInput(input) ? toRelativeDisplayPath(input, cwd) : input
        return truncate(display, 70)
    }
    if (typeof input !== 'object' || Array.isArray(input)) return truncate(String(input), 70)

    const record = input as Record<string, unknown>
    const keys = ['cmd', 'path', 'file_path', 'dir_path', 'query', 'pattern', 'url', 'content']
    const pathKeys = new Set(['path', 'file_path', 'dir_path'])

    for (const key of keys) {
        const raw = record[key]
        if (raw === undefined || raw === null || raw === '') continue

        const value = String(raw)
        const display = pathKeys.has(key) ? toRelativeDisplayPath(value, cwd) : value
        return truncate(display, 70)
    }

    return truncate(safeStringify(record), 70)
}

export const SystemCell = memo(function SystemCell({ message }: { message: SystemMessage }) {
    const color = message.tone === 'error' ? 'red' : message.tone === 'warning' ? 'yellow' : 'cyan'

    return (
        <Box flexDirection="column">
            <Text color={color}>● {message.title}</Text>
            <Text color="gray">{message.content}</Text>
        </Box>
    )
})

const StepCell = memo(function StepCell({ step, cwd }: { step: StepView; cwd: string }) {
    const isParallel = Boolean(step.parallelActions && step.parallelActions.length > 1)
    const singleActionParam = !isParallel && step.action ? mainParam(step.action.input, cwd) : null

    return (
        <Box flexDirection="column">
            {step.thinking ? (
                <Box>
                    <Text color="gray">● </Text>
                    <Text color="gray">{step.thinking}</Text>
                </Box>
            ) : null}

            {isParallel
                ? step.parallelActions?.map((action, index) => {
                      const param = mainParam(action.input, cwd)
                      return (
                          <Box key={`${action.tool}-${index}`}>
                              <Text color={statusColor(step.parallelToolStatuses?.[index] ?? step.toolStatus)}>● </Text>
                              <Text color="gray">Used </Text>
                              <Text color="cyan">{action.tool}</Text>
                              {param ? <Text color="gray"> ({param})</Text> : null}
                          </Box>
                      )
                  })
                : null}

            {!isParallel && step.action ? (
                <Box>
                    <Text color={statusColor(step.toolStatus)}>● </Text>
                    <Text color="gray">Used </Text>
                    <Text color="cyan">{step.action.tool}</Text>
                    {singleActionParam ? <Text color="gray"> ({singleActionParam})</Text> : null}
                </Box>
            ) : null}
        </Box>
    )
})

export const TurnCell = memo(function TurnCell({ turn, cwd }: { turn: TurnView; cwd: string }) {
    return (
        <Box flexDirection="column">
            <Box marginY={0.5}>
                <Text color="gray">› </Text>
                <Text>{turn.userInput}</Text>
            </Box>

            {turn.steps.map((step) => (
                <StepCell key={`${turn.index}-${step.index}`} step={step} cwd={cwd} />
            ))}

            {turn.finalText ? (
                <Box marginTop={0}>
                    <MarkdownRenderer content={turn.finalText} />
                </Box>
            ) : null}

            {turn.status && turn.status !== 'ok' ? <Text color="red">Status: {turn.status}</Text> : null}

            {turn.errorMessage ? <Text color="red">{turn.errorMessage}</Text> : null}
        </Box>
    )
})
