import { describe, expect, test } from 'vitest'
import { buildThinking } from '@memo/core/utils/utils'

describe('buildThinking', () => {
    test('strips <think> tags and keeps inner text', () => {
        const thinking = buildThinking(['<think>plan steps here</think>'])
        expect(thinking).toBe('plan steps here')
    })

    test('aggregates multiple think blocks', () => {
        const thinking = buildThinking(['<think>first</think>', 'ignored', '<thinking>second</thinking>'])
        expect(thinking).toBe('first\n\nsecond')
    })

    test('returns cleaned text when no think tags exist', () => {
        const thinking = buildThinking(['plain reasoning'])
        expect(thinking).toBe('plain reasoning')
    })
})
