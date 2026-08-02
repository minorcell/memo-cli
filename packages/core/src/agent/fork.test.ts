import { describe, expect, test } from 'vitest'
import { buildForkHistory } from './fork'

describe('buildForkHistory', () => {
    test('keeps user turns and final assistant text while dropping tools and reasoning', () => {
        const history = buildForkHistory(
            [
                { role: 'system', content: 'parent' },
                { role: 'user', content: 'first' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'answer' },
                        { type: 'reasoning', text: 'private' },
                    ],
                },
                { role: 'tool', content: [] },
                { role: 'user', content: 'second' },
            ],
            'child',
            1,
        )
        expect(history).toEqual([
            { role: 'system', content: 'child' },
            { role: 'user', content: 'second' },
        ])
    })
})
