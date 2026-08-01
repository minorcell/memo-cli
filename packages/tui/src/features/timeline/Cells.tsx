import { memo } from 'react'
import { Box, Text, useStdout } from 'ink'
import {
    TOOL_STATUS,
    type SystemMessage,
    type StepView,
    type ToolAction,
    type ToolResultView,
    type ToolStatus,
    type TurnView,
} from '../../shared/types'
import { looksLikePathInput, safeStringify, toRelativeDisplayPath } from '../../shared/lib/utils'
import { previewText } from './contentPreview'
import { MarkdownRenderer } from './MarkdownRenderer'
import { summarizeToolResult } from './toolResultSummary'
import { parsePlanUpdateObservation, planProgress } from '../plan/planState'

const TOOL_PARAM_MAX_COLUMNS = 70
const THINKING_PREFIX_COLUMNS = 11

function toolStatusPresentation(status?: ToolStatus): { glyph: string; verb: string; color: string } {
    if (status === TOOL_STATUS.ERROR) return { glyph: '×', verb: 'Failed', color: 'red' }
    if (status === TOOL_STATUS.SUCCESS) return { glyph: '✓', verb: 'Ran', color: 'green' }
    if (status === TOOL_STATUS.EXECUTING) return { glyph: '›', verb: 'Running', color: 'yellow' }
    return { glyph: '○', verb: 'Pending', color: 'gray' }
}

function toolActionText(tool: string, param: string | null, status?: ToolStatus, result?: ToolResultView): string {
    if (status === TOOL_STATUS.ERROR) return `Failed ${tool}${param ? ` · ${param}` : ''}`

    if (tool === 'update_plan') {
        if (status === TOOL_STATUS.EXECUTING) return 'Updating plan'
        const update = result ? parsePlanUpdateObservation(result.observation) : null
        if (update) {
            const progress = planProgress(update)
            return `Updated plan · ${progress.completed}/${progress.total} complete`
        }
        if (result?.observation.includes('reason="simple_task"')) return 'Skipped plan · task is simple'
        return status === TOOL_STATUS.SUCCESS ? 'Updated plan' : 'Pending update_plan'
    }

    const running = status === TOOL_STATUS.EXECUTING
    if (tool === 'read_text_file') return `${running ? 'Reading' : 'Read'} ${param ?? tool}`
    if (tool === 'list_directory') return `${running ? 'Listing' : 'Listed'} ${param ?? tool}`
    if (tool === 'search_files') return `${running ? 'Searching' : 'Searched'} ${param ?? tool}`

    const verb = running ? 'Running' : status === TOOL_STATUS.SUCCESS ? 'Ran' : 'Pending'
    return `${verb} ${tool}${param ? ` · ${param}` : ''}`
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
    const glyph = message.tone === 'error' ? '×' : message.tone === 'warning' ? '!' : '•'

    return (
        <Box marginTop={1}>
            <Text color={color}>{glyph} </Text>
            <Text bold color={color}>
                {message.title}
            </Text>
            <Text color="gray"> · {message.content}</Text>
        </Box>
    )
})

const ToolRow = memo(function ToolRow({
    tool,
    input,
    status,
    result,
    cwd,
    terminalWidth,
}: {
    tool: string
    input: unknown
    status?: ToolStatus
    result?: ToolResultView
    cwd: string
    terminalWidth: number
}) {
    const presentation = toolStatusPresentation(status)
    const param =
        tool === 'update_plan'
            ? null
            : mainParam(
                  input,
                  cwd,
                  Math.min(
                      TOOL_PARAM_MAX_COLUMNS,
                      Math.max(1, terminalWidth - tool.length - presentation.verb.length - 8),
                  ),
              )
    const actionText = toolActionText(tool, param, status, result)
    const resultLines =
        result && !(tool === 'update_plan' && status !== TOOL_STATUS.ERROR)
            ? summarizeToolResult(result, cwd, Math.max(1, terminalWidth - 6))
            : []

    return (
        <Box flexDirection="column">
            <Box>
                <Text wrap="truncate-end">
                    <Text color={presentation.color}>{presentation.glyph} </Text>
                    <Text color={status === TOOL_STATUS.ERROR ? 'red' : 'gray'}>{actionText}</Text>
                </Text>
            </Box>
            {resultLines.map((line, index) => (
                <Box key={`${index}-${line}`} paddingLeft={2}>
                    <Text color={status === TOOL_STATUS.ERROR ? 'red' : 'gray'} dimColor>
                        {index === resultLines.length - 1 ? '└' : '├'} {line}
                    </Text>
                </Box>
            ))}
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
    const actions: ToolAction[] = isParallel ? (step.parallelActions ?? []) : step.action ? [step.action] : []
    const thinking = step.thinking ?? step.streamingThinking
    const thinkingPreview = thinking
        ? previewText(thinking.replace(/\s+/g, ' ').trim(), {
              columns: Math.max(1, terminalWidth - THINKING_PREFIX_COLUMNS),
              maxLines: 1,
              from: 'end',
          }).text
        : null

    const resultForAction = (action: ToolAction, index: number): ToolResultView | undefined => {
        const matched = action.toolCallId
            ? step.toolResults?.find((result) => result.toolCallId === action.toolCallId)
            : undefined
        if (matched) return matched
        if (step.toolResults?.[index]) return step.toolResults[index]
        if (actions.length === 1 && step.observation) {
            return {
                toolCallId: action.toolCallId,
                tool: action.tool,
                observation: step.observation,
                status: step.toolStatus ?? TOOL_STATUS.PENDING,
            }
        }
        return undefined
    }

    return (
        <Box flexDirection="column">
            {thinkingPreview ? (
                <Box>
                    <Text wrap="truncate-end">
                        <Text color={step.streamingThinking && !step.action ? 'yellow' : 'gray'} italic>
                            Thinking
                        </Text>
                        <Text color="gray" dimColor>
                            {' · '}
                            {thinkingPreview}
                        </Text>
                    </Text>
                </Box>
            ) : null}

            {showText && step.assistantText ? (
                <Box marginTop={thinkingPreview ? 1 : 0}>
                    <Text color="green">● </Text>
                    <Text>{step.assistantText}</Text>
                </Box>
            ) : null}

            {actions.map((action, index) => {
                const result = resultForAction(action, index)
                return (
                    <ToolRow
                        key={action.toolCallId ?? `${action.tool}-${index}`}
                        tool={action.tool}
                        input={action.input}
                        status={result?.status ?? step.parallelToolStatuses?.[index] ?? step.toolStatus}
                        result={result}
                        cwd={cwd}
                        terminalWidth={terminalWidth}
                    />
                )
            })}
        </Box>
    )
})

function formatTurnMeta(turn: TurnView): string | null {
    const parts: string[] = []
    if (turn.durationMs !== undefined) {
        parts.push(turn.durationMs < 1000 ? `${turn.durationMs}ms` : `${(turn.durationMs / 1000).toFixed(1)}s`)
    }
    const totalTokens = turn.tokenUsage?.totalTokens
    if (totalTokens && totalTokens > 0) {
        parts.push(`${totalTokens.toLocaleString()} tokens`)
    }
    return parts.length > 0 ? parts.join(' · ') : null
}

export const TurnCell = memo(function TurnCell({ turn, cwd }: { turn: TurnView; cwd: string }) {
    const { stdout } = useStdout()
    const terminalWidth = stdout?.columns ?? process.stdout?.columns ?? 80
    // While the turn is still streaming, step.assistantText holds the live text
    // (finalText is only set on turn completion).
    const inProgress = !turn.finalText && !(turn.status && turn.status !== 'ok')
    const turnMeta = formatTurnMeta(turn)

    return (
        <Box flexDirection="column" marginTop={1}>
            <Box>
                <Text wrap="wrap">
                    <Text bold color="cyan">
                        ›{' '}
                    </Text>
                    <Text bold>{turn.userInput}</Text>
                </Text>
            </Box>

            {turn.steps.length > 0 ? (
                <Box flexDirection="column" marginTop={1}>
                    {turn.steps.map((step, index) => (
                        <Box key={`${turn.index}-${step.index}`} flexDirection="column" marginTop={index > 0 ? 1 : 0}>
                            <StepCell step={step} cwd={cwd} terminalWidth={terminalWidth} showText={inProgress} />
                        </Box>
                    ))}
                </Box>
            ) : null}

            {turn.finalText ? (
                <Box marginTop={1}>
                    <Text color="green">● </Text>
                    <Box flexDirection="column" flexShrink={1}>
                        <MarkdownRenderer content={turn.finalText} />
                    </Box>
                </Box>
            ) : null}

            {turn.status && turn.status !== 'ok' ? (
                <Box marginTop={1}>
                    <Text color={turn.status === 'cancelled' ? 'yellow' : 'red'}>
                        {turn.status === 'cancelled'
                            ? 'Cancelled'
                            : turn.status === 'prompt_limit'
                              ? 'Context limit reached'
                              : 'Turn failed'}
                    </Text>
                </Box>
            ) : null}

            {turn.errorMessage ? <Text color="red">{turn.errorMessage}</Text> : null}

            {turnMeta ? (
                <Text color="gray" dimColor>
                    {'  '}
                    {turnMeta}
                </Text>
            ) : null}
        </Box>
    )
})
