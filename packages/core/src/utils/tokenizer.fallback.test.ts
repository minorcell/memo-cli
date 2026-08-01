import { beforeEach, describe, expect, test, vi } from 'vitest'

// Simulate a tiktoken load failure (e.g. corrupted bundle): the counter must
// fall back to the byte estimate and keep working. Kept in a separate file
// because the encoding singleton caches success across tests.
vi.mock('js-tiktoken/lite', () => ({
    Tiktoken: class {
        constructor() {
            throw new Error('mock load failure')
        }
    },
}))
vi.mock('js-tiktoken/ranks/cl100k_base', () => ({ default: {} }))

describe('createTokenCounter fallback', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    test('countText falls back to the byte estimate when tiktoken load fails', async () => {
        const { createTokenCounter: fresh } = await import('@memo/core/utils/tokenizer')
        const counter = fresh()
        expect(counter.countText('hello')).toBe(2) // 5 bytes → ceil(5/4)
        expect(counter.countText('')).toBe(0)
    })

    test('countMessages falls back to JSON-serialized byte estimates', async () => {
        const { createTokenCounter: fresh } = await import('@memo/core/utils/tokenizer')
        const counter = fresh()
        const messages = [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Hello there!' },
        ]
        const expected = messages.reduce((sum, message) => sum + counter.countText(JSON.stringify(message)), 0)
        expect(counter.countMessages(messages)).toBe(expected)
    })
})
