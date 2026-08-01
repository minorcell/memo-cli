import type { ContextUsagePhase, LanguageModelUsage, TurnStatus } from '@memo/core'
import type { StepView, SystemMessage, SystemMessageTone, ToolAction, ToolStatus, TurnView } from '../../shared/types'
import { TOOL_STATUS } from '../../shared/types'

export type ChatTimelineState = {
    turns: TurnView[]
    historicalTurns: TurnView[]
    systemMessages: SystemMessage[]
    sequence: number
}

export type ChatTimelineAction =
    | { type: 'append_system_message'; title: string; content: string; tone?: SystemMessageTone }
    | { type: 'turn_start'; turn: number; input: string; promptTokens?: number }
    | {
          type: 'context_usage'
          turn: number
          step: number
          promptTokens: number
          phase: ContextUsagePhase
      }
    | { type: 'assistant_chunk'; turn: number; step: number; chunk: string }
    | {
          type: 'tool_action'
          turn: number
          step: number
          action: ToolAction
          thinking?: string
          parallelActions?: ToolAction[]
      }
    | {
          type: 'tool_observation'
          turn: number
          step: number
          observation: string
          toolStatus: ToolStatus
          parallelToolStatuses?: ToolStatus[]
      }
    | {
          type: 'turn_final'
          turn: number
          finalText: string
          status: TurnStatus
          errorMessage?: string
          turnUsage: LanguageModelUsage
          tokenUsage?: LanguageModelUsage
          /** Thinking trace of the final step (rendered on the last step cell). */
          thinking?: string
      }
    | { type: 'replace_history'; turns: TurnView[]; maxSequence: number }
    | { type: 'clear_current_timeline' }
    | { type: 'reset_all' }

export function createInitialTimelineState(): ChatTimelineState {
    return {
        turns: [],
        historicalTurns: [],
        systemMessages: [],
        sequence: 0,
    }
}

function createEmptyTurn(index: number, sequence: number): TurnView {
    return {
        index,
        userInput: '',
        steps: [],
        sequence,
    }
}

function ensureStep(steps: StepView[], step: number): StepView[] {
    // Only copy if we actually need to add steps
    if (steps.length > step) {
        return steps
    }
    const next = steps.slice()
    while (next.length <= step) {
        next.push({ index: next.length, assistantText: '' })
    }
    return next
}

function upsertTurn(
    state: ChatTimelineState,
    turn: number,
    updater: (turnView: TurnView) => TurnView,
): { turns: TurnView[]; sequence: number } {
    const turns = state.turns.slice()
    const existingIndex = turns.findIndex((item) => item.index === turn)

    if (existingIndex === -1) {
        const nextSequence = state.sequence + 1
        turns.push(updater(createEmptyTurn(turn, nextSequence)))
        return { turns, sequence: nextSequence }
    }

    const existing = turns[existingIndex]
    if (!existing) return { turns, sequence: state.sequence }

    turns[existingIndex] = updater(existing)
    return { turns, sequence: state.sequence }
}

function nextSystemMessage(action: {
    title: string
    content: string
    tone?: SystemMessageTone
    sequence: number
}): SystemMessage {
    return {
        // Sequence is monotonically increasing per timeline, so it is a stable unique id.
        id: String(action.sequence),
        title: action.title,
        content: action.content,
        tone: action.tone ?? 'info',
        sequence: action.sequence,
    }
}

export function chatTimelineReducer(state: ChatTimelineState, action: ChatTimelineAction): ChatTimelineState {
    switch (action.type) {
        case 'append_system_message': {
            const sequence = state.sequence + 1
            return {
                ...state,
                sequence,
                systemMessages: [
                    ...state.systemMessages,
                    nextSystemMessage({
                        title: action.title,
                        content: action.content,
                        tone: action.tone,
                        sequence,
                    }),
                ],
            }
        }

        case 'turn_start': {
            const updated = upsertTurn(state, action.turn, (turnView) => ({
                ...turnView,
                index: action.turn,
                userInput: action.input,
                steps: [],
                finalText: undefined,
                status: undefined,
                errorMessage: undefined,
                tokenUsage: undefined,
                startedAt: Date.now(),
                durationMs: undefined,
                contextPromptTokens: action.promptTokens ?? turnView.contextPromptTokens,
            }))
            return {
                ...state,
                turns: updated.turns,
                sequence: updated.sequence,
            }
        }

        case 'context_usage': {
            const updated = upsertTurn(state, action.turn, (turnView) => {
                const steps = ensureStep(turnView.steps, action.step)
                const currentStep = steps[action.step]
                if (!currentStep) return turnView
                steps[action.step] = {
                    ...currentStep,
                    contextPromptTokens: action.promptTokens,
                }
                return {
                    ...turnView,
                    contextPromptTokens: action.promptTokens,
                    steps,
                }
            })
            return {
                ...state,
                turns: updated.turns,
                sequence: updated.sequence,
            }
        }

        case 'assistant_chunk': {
            const updated = upsertTurn(state, action.turn, (turnView) => {
                const steps = ensureStep(turnView.steps, action.step)
                const currentStep = steps[action.step]
                if (!currentStep) return turnView
                // Only create new step object if assistantText actually changed
                const newText = `${currentStep.assistantText}${action.chunk}`
                if (newText === currentStep.assistantText) {
                    return turnView
                }
                steps[action.step] = {
                    ...currentStep,
                    assistantText: newText,
                }
                return { ...turnView, steps }
            })
            return {
                ...state,
                turns: updated.turns,
                sequence: updated.sequence,
            }
        }

        case 'tool_action': {
            const updated = upsertTurn(state, action.turn, (turnView) => {
                const steps = ensureStep(turnView.steps, action.step)
                const currentStep = steps[action.step]
                if (!currentStep) return turnView
                steps[action.step] = {
                    ...currentStep,
                    action: action.action,
                    thinking: action.thinking,
                    parallelActions:
                        action.parallelActions && action.parallelActions.length > 1
                            ? action.parallelActions
                            : undefined,
                    toolStatus: TOOL_STATUS.EXECUTING,
                }
                return { ...turnView, steps }
            })
            return {
                ...state,
                turns: updated.turns,
                sequence: updated.sequence,
            }
        }

        case 'tool_observation': {
            const updated = upsertTurn(state, action.turn, (turnView) => {
                const steps = ensureStep(turnView.steps, action.step)
                const currentStep = steps[action.step]
                if (!currentStep) return turnView
                steps[action.step] = {
                    ...currentStep,
                    observation: action.observation,
                    toolStatus: action.toolStatus,
                    parallelToolStatuses: action.parallelToolStatuses,
                }
                return { ...turnView, steps }
            })
            return {
                ...state,
                turns: updated.turns,
                sequence: updated.sequence,
            }
        }

        case 'turn_final': {
            const updated = upsertTurn(state, action.turn, (turnView) => {
                const startedAt = turnView.startedAt ?? Date.now()
                const durationMs = Math.max(0, Date.now() - startedAt)
                const promptTokens = action.tokenUsage?.inputTokens ?? turnView.contextPromptTokens
                const steps = [...turnView.steps]
                if (action.thinking && steps.length > 0) {
                    const last = steps[steps.length - 1]
                    if (last) steps[steps.length - 1] = { ...last, thinking: action.thinking }
                }
                return {
                    ...turnView,
                    steps,
                    finalText: action.finalText,
                    status: action.status,
                    errorMessage: action.errorMessage,
                    tokenUsage: action.turnUsage,
                    contextPromptTokens: promptTokens,
                    startedAt,
                    durationMs,
                }
            })
            return {
                ...state,
                turns: updated.turns,
                sequence: updated.sequence,
            }
        }

        case 'replace_history': {
            return {
                ...state,
                historicalTurns: action.turns,
                sequence: Math.max(state.sequence, action.maxSequence),
            }
        }

        case 'clear_current_timeline': {
            return {
                ...state,
                turns: [],
                systemMessages: [],
            }
        }

        case 'reset_all': {
            return createInitialTimelineState()
        }

        default:
            return state
    }
}
