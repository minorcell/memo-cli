import { memo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { TOOL_STATUS, type SystemMessage, type StepView, type ToolStatus, type TurnView } from '../../shared/types'
import { looksLikePathInput, safeStringify, toRelativeDisplayPath } from '../../shared/lib/utils'
import { previewText } from './contentPreview'
import { MarkdownRenderer } from './MarkdownRenderer'

const TOOL_PARAM_MAX_COLUMNS = 70
const THINKING_PREVIEW_LINES = 4

function statusColor(status?: ToolStatus): string {
    if (status === TOOL_STATUS.ERROR) return 'red'
    if (status === TOOL_STATUS.EXECUTING) return 'yellow'
    return 'green'
}

function mainParam(input: unknown, cwd: string, columns: number): string | null {
    if (input === undefined || input === null) return null
    let value: string
    if (typeof input === 'string') {
        value = looksLikePathInput(input) ? toRelativeDisplayPath(input, cwd) : input
    } else if (typeof input !== 'object' || Array.isArray(input)) {
        value = String(input)
    } else {
        const record = input as Record<string, unknown>
        const keys = ['cmd', 'path', 'file_path', 'dir_path', 'query', 'pattern', 'url', 'content']
        const pathKeys = new Set(['path', 'file_path', 'dir_path'])
        const mainKey = keys.find((key) => {
            const raw = record[key]
            return raw !== undefined && raw !== null && raw !== ''
        })
        if (mainKey) {
            const raw = String(record[mainKey])
            value = pathKeys.has(mainKey) ? toRelativeDisplayPath(raw, cwd) : raw
        } else {
            value = safeStringify(record)
        }
    }

    const singleLine = value.replace(/\s+/g, ' ').trim()
    if (!singleLine) return null
    return previewText(singleLine, { columns, maxLines: 1 }).text
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

const StepCell = memo(function StepCell({
    step,
    cwd,
    terminalWidth,
    showText = false,
}: {
    step: StepView
    cwd: string
    terminalWidth: number
    showText?: boolean
}) {
    const isParallel = Boolean(step.parallelActions && step.parallelActions.length > 1)
    const thinking = step.thinking ?? step.streamingThinking
    const thinkingPreview = thinking
        ? previewText(thinking, {
              columns: Math.max(1, terminalWidth - 2),
              maxLines: THINKING_PREVIEW_LINES,
              from: 'end',
          }).text
        : null
    const singleActionParam =
        !isParallel && step.action
            ? mainParam(
                  step.action.input,
                  cwd,
                  Math.min(TOOL_PARAM_MAX_COLUMNS, Math.max(1, terminalWidth - step.action.tool.length - 10)),
              )
            : null

    return (
        <Box flexDirection="column">
            {thinkingPreview ? (
                <Box>
                    <Text color="gray">● </Text>
                    <Text color="gray">{thinkingPreview}</Text>
                </Box>
            ) : null}

            {showText && step.assistantText ? <Text>{step.assistantText}</Text> : null}

            {isParallel
                ? step.parallelActions?.map((action, index) => {
                      const param = mainParam(
                          action.input,
                          cwd,
                          Math.min(TOOL_PARAM_MAX_COLUMNS, Math.max(1, terminalWidth - action.tool.length - 10)),
                      )
                      return (
                          <Box key={`${action.tool}-${index}`}>
                              <Text wrap="truncate-end">
                                  <Text color={statusColor(step.parallelToolStatuses?.[index] ?? step.toolStatus)}>
                                      ●{' '}
                                  </Text>
                                  <Text color="gray">Used </Text>
                                  <Text color="cyan">{action.tool}</Text>
                                  {param ? <Text color="gray"> ({param})</Text> : null}
                              </Text>
                          </Box>
                      )
                  })
                : null}

            {!isParallel && step.action ? (
                <Box>
                    <Text wrap="truncate-end">
                        <Text color={statusColor(step.toolStatus)}>● </Text>
                        <Text color="gray">Used </Text>
                        <Text color="cyan">{step.action.tool}</Text>
                        {singleActionParam ? <Text color="gray"> ({singleActionParam})</Text> : null}
                    </Text>
                </Box>
            ) : null}
        </Box>
    )
})

export const TurnCell = memo(function TurnCell({ turn, cwd }: { turn: TurnView; cwd: string }) {
    const { stdout } = useStdout()
    const terminalWidth = stdout?.columns ?? process.stdout?.columns ?? 80
    // While the turn is still streaming, step.assistantText holds the live text
    // (finalText is only set on turn completion).
    const inProgress = !turn.finalText && !(turn.status && turn.status !== 'ok')

    return (
        <Box flexDirection="column">
            <Box marginY={1}>
                <Text color="gray">› </Text>
                <Text>{turn.userInput}</Text>
            </Box>

            {turn.steps.map((step) => (
                <StepCell
                    key={`${turn.index}-${step.index}`}
                    step={step}
                    cwd={cwd}
                    terminalWidth={terminalWidth}
                    showText={inProgress}
                />
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
