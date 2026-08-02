import { describe, expect, test } from 'vitest'
import { AgentRegistry, ExecutionLimiter } from './registry'

describe('AgentRegistry', () => {
    test('reserves paths atomically and rolls failed spawns back', () => {
        const registry = new AgentRegistry()
        registry.registerRoot('root-id')
        const reservation = registry.reserve('/root', 'review', 3)
        expect(() => registry.reserve('/root', 'review', 3)).toThrow('already exists')
        reservation.release()
        expect(registry.reserve('/root', 'review', 3).agentPath).toBe('/root/review')
    })
})

describe('ExecutionLimiter', () => {
    test('limits running turns independently of registered identities', () => {
        const limiter = new ExecutionLimiter(1)
        const first = limiter.tryAcquire()
        expect(first).not.toBeNull()
        expect(limiter.tryAcquire()).toBeNull()
        first?.release()
        expect(limiter.tryAcquire()).not.toBeNull()
    })
})
