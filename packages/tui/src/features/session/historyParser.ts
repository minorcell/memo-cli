import {
    CONTEXT_SUMMARY_PREFIX,
    parseHistoryLogToSessionDetail,
    type ChatMessage,
    type SessionTurnDetail,
    type SessionTurnStep,
} from '@memo/core'
import { TOOL_STATUS, type StepView, type TurnView } from '../../shared/types'

export type ParsedHistoryLog = {
    summary: string
    messages: ChatMessage[]
    turns: TurnView[]
    maxSequence: number
    providerName?: string
    modelName?: string
    toolPermissionMode?: string
    thinking?: boolean
    compactionSummary?: string
}

function toAssistantText(turn: SessionTurnDetail): string {
    const finalText = turn.finalText?.trim()
    if (finalText) return finalText
    return turn.steps
        .map((step) => step.assistantText ?? '')
        .join('')
        .trim()
}

function normalizeTurnStatus(value: unknown): TurnView['status'] | undefined {
    return value === 'ok' || value === 'error' || value === 'cancelled' ? value : undefined
}

function toToolStatus(step: SessionTurnStep): StepView['toolStatus'] {
    if (!step.resultStatus) return undefined
    return step.resultStatus === 'success' ? TOOL_STATUS.SUCCESS : TOOL_STATUS.ERROR
}

function normalizeToolResultStatus(value: string | undefined): NonNullable<StepView['toolStatus']> {
    if (!value) return TOOL_STATUS.PENDING
    return value === 'success' ? TOOL_STATUS.SUCCESS : TOOL_STATUS.ERROR
}

function toTurnView(turn: SessionTurnDetail, sequence: number, turnIndex: number): TurnView {
    return {
        index: -(turnIndex + 1),
        userInput: turn.input ?? '',
        steps: (turn.steps ?? []).map((step) => ({
            index: step.step,
            assistantText: step.assistantText ?? '',
            thinking: step.thinking,
            action: step.action,
            parallelActions: step.parallelActions,
            toolResults: step.toolResults?.map((result) => ({
                toolCallId: result.toolCallId,
                tool: result.tool,
                observation: result.observation,
                status: normalizeToolResultStatus(result.resultStatus),
            })),
            observation: step.observation,
            toolStatus: toToolStatus(step),
        })),
        status: normalizeTurnStatus(turn.status),
        errorMessage: turn.errorMessage,
        tokenUsage: turn.tokenUsage,
        finalText: toAssistantText(turn),
        sequence,
    }
}

export function parseHistoryLog(raw: string): ParsedHistoryLog {
    const detail = parseHistoryLogToSessionDetail(raw, 'history.log')
    const orderedTurns = [...detail.turns].sort((left, right) => left.turn - right.turn)

    const messages: ChatMessage[] = []
    // Re-inject the latest compaction summary as the first user message, in the
    // same shape the compaction engine produces, so restored sessions keep the
    // context that was compacted away (and later compactions recognize it).
    const summaryText = detail.compactionSummary?.trim()
    if (summaryText) {
        messages.push({ role: 'user', content: `${CONTEXT_SUMMARY_PREFIX}\n${summaryText}` })
    }
    for (const turn of orderedTurns) {
        const input = (turn.input ?? '').trim()
        if (input) {
            messages.push({ role: 'user', content: input })
        }

        const assistant = toAssistantText(turn)
        if (assistant) {
            messages.push({ role: 'assistant', content: assistant })
        }
    }

    let sequence = 0
    const turns = orderedTurns.map((turn, index) => {
        sequence += 1
        return toTurnView(turn, sequence, index)
    })

    return {
        summary: detail.summary,
        messages,
        turns,
        maxSequence: sequence,
        providerName: detail.providerName,
        modelName: detail.modelName,
        toolPermissionMode: detail.toolPermissionMode,
        thinking: detail.thinking,
        compactionSummary: detail.compactionSummary,
    }
}
