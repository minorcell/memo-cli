import { describe, expect, test } from 'vitest'
import { accumulateUsage, emptyUsage } from '@memo/core/utils/usage'

describe('accumulateUsage', () => {
    test('uses explicit total when provided', () => {
        const usage = emptyUsage()
        accumulateUsage(usage, { inputTokens: 2, outputTokens: 3, totalTokens: 100 })
        expect(usage).toEqual({ ...emptyUsage(), inputTokens: 2, outputTokens: 3, totalTokens: 100 })
    })

    test('falls back to input + output when total is absent', () => {
        const usage = emptyUsage()
        accumulateUsage(usage, { inputTokens: 2, outputTokens: 3 })
        expect(usage).toEqual({ ...emptyUsage(), inputTokens: 2, outputTokens: 3, totalTokens: 5 })
    })
})
