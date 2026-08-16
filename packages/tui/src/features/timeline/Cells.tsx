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
const THINKING_LIVE_LINES = 3

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
    if (tool === 'read') return `${running ? 'Reading' : 'Read'} ${param ?? tool}`
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

function resolveStepActions(step: StepView): ToolAction[] {
    const isParallel = Boolean(step.parallelActions && step.parallelActions.length > 1)
    return isParallel ? (step.parallelActions ?? []) : step.action ? [step.action] : []
}

function resolveActionResult(step: StepView, action: ToolAction, index: number): ToolResultView | undefined {
    const actions = resolveStepActions(step)
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
    const actions = resolveStepActions(step)
    const thinking = step.thinking ?? step.streamingThinking
    const isLiveThinking = Boolean(step.streamingThinking && !step.action)
    const thinkingColumns = Math.max(1, terminalWidth - THINKING_PREFIX_COLUMNS)
    // While thinking is streaming, show a rolling tail of the latest lines;
    // once it completes, collapse to a single-line preview.
    const thinkingLines = thinking
        ? isLiveThinking
            ? previewText(thinking, {
                  columns: thinkingColumns,
                  maxLines: THINKING_LIVE_LINES,
                  from: 'end',
              }).text.split('\n')
            : [
                  previewText(thinking.replace(/\s+/g, ' ').trim(), {
                      columns: thinkingColumns,
                      maxLines: 1,
                      from: 'end',
                  }).text,
              ]
        : []

    const resultForAction = (action: ToolAction, index: number): ToolResultView | undefined =>
        resolveActionResult(step, action, index)

    return (
        <Box flexDirection="column">
            {thinkingLines.length > 0 ? (
                <Box flexDirection="column">
                    {thinkingLines.map((line, index) => (
                        <Box key={index}>
                            <Text color={isLiveThinking ? 'yellow' : 'gray'} italic>
                                {index === 0 ? 'Thinking' : '        '}
                            </Text>
                            <Text color="gray" dimColor>
                                {' · '}
                                {line}
                            </Text>
                        </Box>
                    ))}
                </Box>
            ) : null}

            {showText && step.assistantText ? (
                <Box marginTop={thinkingLines.length > 0 ? 1 : 0}>
                    <Text color="green">● </Text>
                    <Box flexDirection="column" flexShrink={1}>
                        <MarkdownRenderer content={step.assistantText} />
                    </Box>
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

const MERGED_TOOL_LABELS: Record<string, (count: number) => string> = {
    read: (count) => `Read ${count} files`,
    list_directory: (count) => `Listed ${count} directories`,
    search_files: (count) => `Searched ${count} patterns`,
}

export type MergedToolGroup = {
    type: 'merged'
    tool: string
    label: string
    params: string[]
}

export type TimelineItem = { type: 'step'; step: StepView } | MergedToolGroup

/**
 * Collapses runs of consecutive, completed read-only tool calls into one
 * merged item (e.g. three consecutive `read` calls render as "Read 3 files"),
 * so long tool sequences don't flood the timeline.
 */
export function collectTimelineItems(steps: StepView[], cwd: string, terminalWidth: number): TimelineItem[] {
    const items: TimelineItem[] = []
    let group: { tool: string; steps: StepView[] } | null = null

    const flushGroup = () => {
        if (!group) return
        if (group.steps.length >= 2) {
            const labelFor = MERGED_TOOL_LABELS[group.tool]
            const params = group.steps.map((step) => {
                const action = resolveStepActions(step)[0]
                return action ? (mainParam(action.input, cwd, terminalWidth) ?? group.tool) : group.tool
            })
            items.push({
                type: 'merged',
                tool: group.tool,
                label: labelFor ? labelFor(group.steps.length) : `${group.tool} ×${group.steps.length}`,
                params,
            })
        } else {
            for (const step of group.steps) {
                items.push({ type: 'step', step })
            }
        }
        group = null
    }

    for (const step of steps) {
        const actions = resolveStepActions(step)
        const singleAction = actions.length === 1 ? actions[0] : undefined
        // Only bare, successful, single-action steps can fold into a group;
        // thinking, text, or failures interrupt the run.
        const absorbable = Boolean(singleAction) && !step.assistantText && !step.thinking && !step.streamingThinking
        const mergable =
            absorbable &&
            Boolean(singleAction) &&
            (singleAction as ToolAction).tool in MERGED_TOOL_LABELS &&
            resolveActionResult(step, singleAction as ToolAction, 0)?.status === TOOL_STATUS.SUCCESS

        if (!mergable || !singleAction) {
            flushGroup()
            items.push({ type: 'step', step })
            continue
        }

        if (!group || group.tool !== singleAction.tool) {
            flushGroup()
            group = { tool: singleAction.tool, steps: [] }
        }
        group.steps.push(step)
    }
    flushGroup()

    return items
}

function MergedToolRow({ label, params }: { label: string; params: string[] }) {
    return (
        <Box flexDirection="column">
            <Box>
                <Text color="green">✓ </Text>
                <Text color="gray">{label}</Text>
            </Box>
            {params.map((param, index) => (
                <Box key={index} paddingLeft={2}>
                    <Text color="gray" dimColor>
                        {index === params.length - 1 ? '└' : '├'} {param}
                    </Text>
                </Box>
            ))}
        </Box>
    )
}

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
                    {collectTimelineItems(turn.steps, cwd, terminalWidth).map((item, index) =>
                        item.type === 'merged' ? (
                            <Box key={`${turn.index}-merged-${index}`} marginTop={index > 0 ? 1 : 0}>
                                <MergedToolRow label={item.label} params={item.params} />
                            </Box>
                        ) : (
                            <Box
                                key={`${turn.index}-${item.step.index}`}
                                flexDirection="column"
                                marginTop={index > 0 ? 1 : 0}
                            >
                                <StepCell
                                    step={item.step}
                                    cwd={cwd}
                                    terminalWidth={terminalWidth}
                                    showText={inProgress}
                                />
                            </Box>
                        ),
                    )}
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
