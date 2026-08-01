import {
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
    }
}
