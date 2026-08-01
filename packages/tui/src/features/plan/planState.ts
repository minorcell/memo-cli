import { TOOL_STATUS, type ToolResultView, type TurnView } from '../../shared/types'

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed'

export type PlanItemView = {
    step: string
    status: PlanItemStatus
}

export type PlanView = {
    explanation?: string
    items: PlanItemView[]
}

export type PlanStateAction =
    | { type: 'tool_result'; result: ToolResultView }
    | { type: 'restore_history'; turns: TurnView[] }
    | { type: 'clear' }

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePlanItem(value: unknown): PlanItemView | null {
    if (!isRecord(value) || typeof value.step !== 'string') return null
    if (value.status !== 'pending' && value.status !== 'in_progress' && value.status !== 'completed') return null

    const step = value.step.trim()
    if (!step) return null
    return { step, status: value.status }
}

export function parsePlanUpdateObservation(observation: string): PlanView | null {
    let value: unknown
    try {
        value = JSON.parse(observation)
    } catch {
        return null
    }

    if (!isRecord(value) || value.message !== 'Plan updated' || !Array.isArray(value.plan)) return null
    const items = value.plan.map(parsePlanItem)
    if (items.length === 0 || items.some((item) => item === null)) return null

    const explanation = typeof value.explanation === 'string' ? value.explanation.trim() : ''
    return {
        explanation: explanation || undefined,
        items: items as PlanItemView[],
    }
}

export function planProgress(plan: PlanView): { completed: number; total: number } {
    return {
        completed: plan.items.filter((item) => item.status === 'completed').length,
        total: plan.items.length,
    }
}

function activePlan(plan: PlanView): PlanView | null {
    return plan.items.every((item) => item.status === 'completed') ? null : plan
}

function applyToolResult(state: PlanView | null, result: ToolResultView): PlanView | null {
    if (result.tool !== 'update_plan' || result.status !== TOOL_STATUS.SUCCESS) return state
    const update = parsePlanUpdateObservation(result.observation)
    return update ? activePlan(update) : state
}

function restorePlan(turns: TurnView[]): PlanView | null {
    let plan: PlanView | null = null
    for (const turn of turns) {
        for (const step of turn.steps) {
            for (const result of step.toolResults ?? []) {
                plan = applyToolResult(plan, result)
            }
        }
    }
    return plan
}

export function planStateReducer(state: PlanView | null, action: PlanStateAction): PlanView | null {
    switch (action.type) {
        case 'tool_result':
            return applyToolResult(state, action.result)
        case 'restore_history':
            return restorePlan(action.turns)
        case 'clear':
            return null
        default:
            return state
    }
}
