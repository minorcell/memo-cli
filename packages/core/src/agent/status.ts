import type { HistoryEvent } from '@memo/core/types'

export type AgentStatus = 'pending_init' | 'running' | 'interrupted' | 'completed' | 'errored' | 'shutdown'

export type AgentStatusSnapshot = {
    status: AgentStatus
    lastMessage?: string
    error?: string
}

export function isFinalAgentStatus(status: AgentStatus): boolean {
    return status === 'completed' || status === 'errored' || status === 'shutdown'
}

export function deriveAgentStatusFromEvent(
    current: AgentStatusSnapshot,
    event: Pick<HistoryEvent, 'type' | 'content' | 'meta'>,
): AgentStatusSnapshot {
    if (event.type === 'final' && event.content !== undefined) {
        return { ...current, lastMessage: event.content }
    }

    if (event.type === 'turn_start') {
        return { status: 'running', lastMessage: current.lastMessage }
    }

    if (event.type === 'turn_end') {
        const turnStatus = event.meta?.status
        if (turnStatus === 'ok') return { status: 'completed', lastMessage: current.lastMessage }
        if (turnStatus === 'cancelled') return { status: 'interrupted', lastMessage: current.lastMessage }
        const error = typeof event.meta?.error_message === 'string' ? event.meta.error_message : undefined
        return { status: 'errored', lastMessage: current.lastMessage, error }
    }

    if (event.type === 'session_end') {
        return { status: 'shutdown', lastMessage: current.lastMessage }
    }

    return current
}
