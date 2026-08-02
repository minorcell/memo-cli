import { describe, expect, test } from 'vitest'
import { deriveAgentStatusFromEvent, isFinalAgentStatus, type AgentStatusSnapshot } from './status'

describe('agent status', () => {
    test('derives lifecycle status from session events', () => {
        let status: AgentStatusSnapshot = { status: 'pending_init' }
        status = deriveAgentStatusFromEvent(status, { type: 'turn_start' })
        expect(status.status).toBe('running')
        status = deriveAgentStatusFromEvent(status, { type: 'final', content: 'done' })
        status = deriveAgentStatusFromEvent(status, { type: 'turn_end', meta: { status: 'ok' } })
        expect(status).toEqual({ status: 'completed', lastMessage: 'done' })
        expect(isFinalAgentStatus(status.status)).toBe(true)
    })

    test('keeps interrupted agents resumable', () => {
        const status = deriveAgentStatusFromEvent(
            { status: 'running' },
            { type: 'turn_end', meta: { status: 'cancelled' } },
        )
        expect(status.status).toBe('interrupted')
        expect(isFinalAgentStatus(status.status)).toBe(false)
    })
})
