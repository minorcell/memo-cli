import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { createTokenCounter } from '@memo/core/utils/tokenizer'
import type { ChatMessage } from '@memo/core/types'

describe('createTokenCounter', () => {
    test('creates counter with default model', () => {
        const counter = createTokenCounter()
        expect(counter.model).toBe('cl100k_base')
        expect(typeof counter.countText).toBe('function')
        expect(typeof counter.countMessages).toBe('function')
        expect(typeof counter.dispose).toBe('function')
        counter.dispose()
    })

    test('creates counter with specified model', () => {
        const counter = createTokenCounter('gpt-4')
        expect(counter.model).toBe('gpt-4')
        counter.dispose()
    })

    test('falls back to cl100k_base for unknown models', () => {
        const counter = createTokenCounter('unknown-model-x')
        expect(counter.model).toBe('cl100k_base')
        counter.dispose()
    })

    test('trims whitespace in model name', () => {
        const counter = createTokenCounter('  gpt-4  ')
        expect(counter.model).toBe('gpt-4')
        counter.dispose()
    })

    describe('countText', () => {
        let counter: ReturnType<typeof createTokenCounter>

        beforeEach(() => {
            counter = createTokenCounter()
        })

        afterEach(() => {
            counter.dispose()
        })

        test('returns 0 for empty string', () => {
            expect(counter.countText('')).toBe(0)
        })

        test('counts tokens for simple text', () => {
            const count = counter.countText('Hello world')
            expect(count).toBeGreaterThan(0)
        })

        test('counts tokens for longer text', () => {
            const short = counter.countText('Hi')
            const long = counter.countText('Hello, this is a longer text with more words.')
            expect(long).toBeGreaterThan(short)
        })

        test('counts tokens for special characters', () => {
            const count = counter.countText('Hello\nWorld\t!\n\n')
            expect(count).toBeGreaterThan(0)
        })

        test('counts tokens for unicode text', () => {
            const count = counter.countText('你好世界 Hello World 🌍')
            expect(count).toBeGreaterThan(0)
        })

        test('counts tokens for JSON strings', () => {
            const json = JSON.stringify({ key: 'value', nested: { a: 1, b: 2 } })
            const count = counter.countText(json)
            expect(count).toBeGreaterThan(0)
        })
    })

    describe('countMessages', () => {
        let counter: ReturnType<typeof createTokenCounter>

        beforeEach(() => {
            counter = createTokenCounter()
        })

        afterEach(() => {
            counter.dispose()
        })

        test('returns 0 for empty array', () => {
            expect(counter.countMessages([])).toBe(0)
        })

        test('counts system message', () => {
            const messages: ChatMessage[] = [{ role: 'system', content: 'You are a helpful assistant.' }]
            const count = counter.countMessages(messages)
            expect(count).toBeGreaterThan(0)
        })

        test('counts user message', () => {
            const messages: ChatMessage[] = [{ role: 'user', content: 'Hello there!' }]
            const count = counter.countMessages(messages)
            expect(count).toBeGreaterThan(0)
        })

        test('counts assistant message', () => {
            const messages: ChatMessage[] = [{ role: 'assistant', content: 'Hi! How can I help?' }]
            const count = counter.countMessages(messages)
            expect(count).toBeGreaterThan(0)
        })

        test('counts tool message', () => {
            const messages: ChatMessage[] = [
                {
                    role: 'tool',
                    content: 'Tool execution result',
                    tool_call_id: 'call-123',
                    name: 'test_tool',
                },
            ]
            const count = counter.countMessages(messages)
            expect(count).toBeGreaterThan(0)
        })

        test('counts multiple messages', () => {
            const messages: ChatMessage[] = [
                { role: 'system', content: 'System prompt' },
                { role: 'user', content: 'User message' },
                { role: 'assistant', content: 'Assistant response' },
            ]
            const firstMsg = messages[0]
            if (firstMsg) {
                const single = counter.countMessages([firstMsg])
                const multiple = counter.countMessages(messages)
                expect(multiple).toBeGreaterThan(single)
            }
        })

        test('includes assistant priming tokens', () => {
            const messages: ChatMessage[] = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi' },
            ]
            const count = counter.countMessages(messages)
            const withoutAssistant = counter.countMessages([{ role: 'user', content: 'Hello' }])
            expect(count).toBeGreaterThan(withoutAssistant)
        })

        test('counts tool_calls in assistant message', () => {
            const messagesWithToolCalls: ChatMessage[] = [
                {
                    role: 'assistant',
                    content: 'Let me check',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'read_file', arguments: '{"path": "test.txt"}' },
                        },
                    ],
                },
            ]
            const messagesWithoutToolCalls: ChatMessage[] = [{ role: 'assistant', content: 'Let me check' }]
            const withCalls = counter.countMessages(messagesWithToolCalls)
            const withoutCalls = counter.countMessages(messagesWithoutToolCalls)
            expect(withCalls).toBeGreaterThan(withoutCalls)
        })

        test('counts reasoning_content in assistant message', () => {
            const messagesWithReasoning: ChatMessage[] = [
                {
                    role: 'assistant',
                    content: '',
                    reasoning_content: 'I should inspect file A before using read_file.',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'read_file', arguments: '{"path":"README.md"}' },
                        },
                    ],
                },
            ]
            const messagesWithoutReasoning: ChatMessage[] = [
                {
                    role: 'assistant',
                    content: '',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'read_file', arguments: '{"path":"README.md"}' },
                        },
                    ],
                },
            ]
            const withReasoning = counter.countMessages(messagesWithReasoning)
            const withoutReasoning = counter.countMessages(messagesWithoutReasoning)
            expect(withReasoning).toBeGreaterThan(withoutReasoning)
        })

        test('includes tool_call_id in tool message counting', () => {
            const messages: ChatMessage[] = [
                {
                    role: 'tool',
                    content: 'Result',
                    tool_call_id: 'call-abc123',
                },
            ]
            const count = counter.countMessages(messages)
            expect(count).toBeGreaterThan(0)
        })

        test('includes name field in tool message counting', () => {
            const messages: ChatMessage[] = [
                {
                    role: 'tool',
                    content: 'Result',
                    tool_call_id: 'call-1',
                    name: 'my_tool',
                },
            ]
            const count = counter.countMessages(messages)
            expect(count).toBeGreaterThan(0)
        })

        test('handles assistant message with only tool_calls and empty content', () => {
            const messages: ChatMessage[] = [
                {
                    role: 'assistant',
                    content: '',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'test', arguments: '{}' },
                        },
                    ],
                },
            ]
            const count = counter.countMessages(messages)
            expect(count).toBeGreaterThan(0)
        })

        test('includes name overhead when message has name field', () => {
            const msg: ChatMessage & { name?: string } = { role: 'system', content: 'Test' }
            msg.name = 'custom_name'
            const messages: ChatMessage[] = [msg]
            const count = counter.countMessages(messages)
            expect(count).toBeGreaterThan(0)
        })

        test('counts complex conversation', () => {
            const messages: ChatMessage[] = [
                { role: 'system', content: 'You are a helpful coding assistant.' },
                { role: 'user', content: 'Write a function that adds two numbers.' },
                {
                    role: 'assistant',
                    content: 'I will create a simple add function for you.',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: {
                                name: 'write_file',
                                arguments: JSON.stringify({
                                    path: 'add.js',
                                    content: 'function add(a, b) { return a + b; }',
                                }),
                            },
                        },
                    ],
                },
                {
                    role: 'tool',
                    content: 'File written successfully',
                    tool_call_id: 'call-1',
                    name: 'write_file',
                },
                {
                    role: 'assistant',
                    content: 'I have created the add.js file with the function.',
                },
            ]
            const count = counter.countMessages(messages)
            expect(count).toBeGreaterThan(0)
        })
    })

    describe('dispose', () => {
        test('disposes counter without error', () => {
            const counter = createTokenCounter()
            counter.dispose()
        })
    })
})
