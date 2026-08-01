import { describe, expect, test } from 'vitest'
import { createTokenCounter } from '@memo/core/utils/tokenizer'
import type { ChatMessage } from '@memo/core/types'

describe('createTokenCounter', () => {
    test('creates counter with countText/countMessages', () => {
        const counter = createTokenCounter()
        expect(typeof counter.countText).toBe('function')
        expect(typeof counter.countMessages).toBe('function')
    })

    describe('countText', () => {
        const counter = createTokenCounter()

        test('returns 0 for empty string', () => {
            expect(counter.countText('')).toBe(0)
        })

        test('estimates ~4 ASCII bytes per token', () => {
            expect(counter.countText('hello')).toBe(2) // 5 bytes → ceil(5/4)
            expect(counter.countText('Hello world')).toBe(3) // 11 bytes → ceil(11/4)
        })

        test('estimates CJK chars (~3 utf8 bytes each)', () => {
            expect(counter.countText('你好')).toBe(2) // 6 bytes → ceil(6/4)
            expect(counter.countText('中文测试')).toBe(3) // 12 bytes → ceil(12/4)
        })

        test('counts longer text more than short text', () => {
            const short = counter.countText('Hi')
            const long = counter.countText('Hello, this is a longer text with more words.')
            expect(long).toBeGreaterThan(short)
        })

        test('counts unicode and special characters', () => {
            expect(counter.countText('你好世界 Hello World 🌍')).toBeGreaterThan(0)
            expect(counter.countText('Hello\nWorld\t!\n\n')).toBeGreaterThan(0)
        })
    })

    describe('countMessages', () => {
        const counter = createTokenCounter()

        test('returns 0 for empty array', () => {
            expect(counter.countMessages([])).toBe(0)
        })

        test('sums JSON-serialized per-message byte estimates', () => {
            const messages: ChatMessage[] = [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Hello there!' },
            ]
            const expected = messages.reduce((sum, message) => sum + counter.countText(JSON.stringify(message)), 0)
            expect(counter.countMessages(messages)).toBe(expected)
        })

        test('counts multiple messages more than a single message', () => {
            const messages: ChatMessage[] = [
                { role: 'system', content: 'System prompt' },
                { role: 'user', content: 'User message' },
                { role: 'assistant', content: 'Assistant response' },
            ]
            const single = counter.countMessages([messages[0]!])
            expect(counter.countMessages(messages)).toBeGreaterThan(single)
        })

        test('includes structured parts (tool-call/reasoning) via JSON serialization', () => {
            const withParts: ChatMessage[] = [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Let me check' },
                        { type: 'reasoning', text: 'I should inspect file A before acting.' },
                        { type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: { path: 'test.txt' } },
                    ],
                },
            ]
            const withoutParts: ChatMessage[] = [{ role: 'assistant', content: 'Let me check' }]
            expect(counter.countMessages(withParts)).toBeGreaterThan(counter.countMessages(withoutParts))
        })

        test('counts tool result messages', () => {
            const messages: ChatMessage[] = [
                {
                    role: 'tool',
                    content: [
                        {
                            type: 'tool-result',
                            toolCallId: 'call-123',
                            toolName: 'test_tool',
                            output: { type: 'text', value: 'Tool execution result' },
                        },
                    ],
                },
            ]
            expect(counter.countMessages(messages)).toBeGreaterThan(0)
        })

        test('counts complex conversation', () => {
            const messages: ChatMessage[] = [
                { role: 'system', content: 'You are a helpful coding assistant.' },
                { role: 'user', content: 'Write a function that adds two numbers.' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'I will create a simple add function for you.' },
                        {
                            type: 'tool-call',
                            toolCallId: 'call-1',
                            toolName: 'write_file',
                            input: {
                                path: 'add.js',
                                content: 'function add(a, b) { return a + b; }',
                            },
                        },
                    ],
                },
                {
                    role: 'tool',
                    content: [
                        {
                            type: 'tool-result',
                            toolCallId: 'call-1',
                            toolName: 'write_file',
                            output: { type: 'text', value: 'File written successfully' },
                        },
                    ],
                },
                {
                    role: 'assistant',
                    content: 'I have created the add.js file with the function.',
                },
            ]
            expect(counter.countMessages(messages)).toBeGreaterThan(0)
        })
    })
})
