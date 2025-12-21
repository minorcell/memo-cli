import type { TokenUsage, TurnStatus } from '@memo/core'

export type ToolStatus = 'pending' | 'executing' | 'success' | 'error'

export type StepView = {
    index: number
    assistantText: string
    action?: { tool: string; input: unknown }
    observation?: string
    toolStatus?: ToolStatus
}

export type TurnView = {
    index: number
    userInput: string
    steps: StepView[]
    status?: TurnStatus
    tokenUsage?: TokenUsage
    finalText?: string
}

export type SystemMessage = {
    id: string
    title: string
    content: string
}
