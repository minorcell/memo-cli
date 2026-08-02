import type { ApprovalRequest } from '@memo/core'
import type { RuntimeStatus } from '../shared/types'

export type TurnRequest = {
    id: string
    input: string
    displayInput: string
}

type ActiveTurn = {
    id: number
    kind: 'turn'
    request: TurnRequest
    stage: 'running' | 'awaiting_approval' | 'cancelling'
    approval?: ApprovalRequest
}

type ActiveCompact = {
    id: number
    kind: 'compact'
}

export type ActiveRuntimeOperation = ActiveTurn | ActiveCompact

export type RuntimeState = {
    active: ActiveRuntimeOperation | null
    pendingApproval: ApprovalRequest | null
    queuedTurns: TurnRequest[]
    nextOperationId: number
}

export type RuntimeAction =
    | { type: 'submit_turn'; request: TurnRequest }
    | { type: 'start_compact' }
    | { type: 'approval_requested'; request: ApprovalRequest }
    | { type: 'approval_resolved' }
    | { type: 'cancel_requested' }
    | { type: 'operation_finished'; operationId: number }
    | { type: 'reset' }

export function createInitialRuntimeState(): RuntimeState {
    return {
        active: null,
        pendingApproval: null,
        queuedTurns: [],
        nextOperationId: 1,
    }
}

function activateTurn(state: RuntimeState, request: TurnRequest, queuedTurns = state.queuedTurns): RuntimeState {
    return {
        active: {
            id: state.nextOperationId,
            kind: 'turn',
            request,
            stage: 'running',
        },
        pendingApproval: state.pendingApproval,
        queuedTurns,
        nextOperationId: state.nextOperationId + 1,
    }
}

export function runtimeStatus(state: RuntimeState): RuntimeStatus {
    if (state.pendingApproval) return 'awaiting_approval'
    if (!state.active) return 'idle'
    if (state.active.kind === 'compact') return 'compacting'
    return state.active.stage
}

export function pendingRuntimeApproval(state: RuntimeState): ApprovalRequest | null {
    return state.pendingApproval
}

export function runtimeReducer(state: RuntimeState, action: RuntimeAction): RuntimeState {
    switch (action.type) {
        case 'submit_turn':
            return state.active
                ? { ...state, queuedTurns: [...state.queuedTurns, action.request] }
                : activateTurn(state, action.request)

        case 'start_compact':
            if (state.active) return state
            return {
                ...state,
                active: { id: state.nextOperationId, kind: 'compact' },
                nextOperationId: state.nextOperationId + 1,
            }

        case 'approval_requested':
            return {
                ...state,
                pendingApproval: action.request,
                active:
                    state.active?.kind === 'turn' && state.active.stage !== 'cancelling'
                        ? { ...state.active, stage: 'awaiting_approval', approval: action.request }
                        : state.active,
            }

        case 'approval_resolved':
            return {
                ...state,
                pendingApproval: null,
                active:
                    state.active?.kind === 'turn' && state.active.stage === 'awaiting_approval'
                        ? { ...state.active, stage: 'running', approval: undefined }
                        : state.active,
            }

        case 'cancel_requested':
            if (state.active?.kind !== 'turn') return state
            return {
                ...state,
                active: {
                    ...state.active,
                    stage: 'cancelling',
                    approval: undefined,
                },
            }

        case 'operation_finished': {
            if (state.active?.id !== action.operationId) return state
            const [nextTurn, ...remainingTurns] = state.queuedTurns
            if (nextTurn) return activateTurn(state, nextTurn, remainingTurns)
            return { ...state, active: null }
        }

        case 'reset':
            return {
                active: null,
                pendingApproval: null,
                queuedTurns: [],
                nextOperationId: state.nextOperationId,
            }
    }
}
