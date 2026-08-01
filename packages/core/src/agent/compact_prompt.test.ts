import assert from 'node:assert'
import { describe, test } from 'vitest'
import type { ChatMessage } from '@memo/core/types'
import {
    buildCompactionUserPrompt,
    CONTEXT_SUMMARY_PREFIX,
    isContextSummaryMessage,
    selectCompactionMessages,
} from '@memo/core/agent/compact_prompt'

describe('compact_prompt', () => {
    test('buildCompactionUserPrompt formats assistant tool calls and tool messages', () => {
        const longToolOutput = 'x'.repeat(4_005)
        const messages: ChatMessage[] = [
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'planning' },
                    { type: 'tool-call', toolCallId: 'call-1', toolName: 'exec_command', input: {} },
                ],
            },
            {
                role: 'tool',
                content: [
                    {
                        type: 'tool-result',
                        toolCallId: 'call-1',
                        toolName: 'exec_command',
                        output: { type: 'text', value: longToolOutput },
                    },
                ],
            },
        ]

        const prompt = buildCompactionUserPrompt(messages)
        assert.ok(prompt.includes('[0] ASSISTANT (tool_calls: exec_command)'))
        assert.ok(prompt.includes('[1] TOOL (exec_command)'))
        // Truncation keeps the tail (tool result/error at the end carries the info).
        assert.ok(prompt.includes(`...${'x'.repeat(4_000)}`))
        assert.ok(prompt.includes('Return only the summary body in plain text. Do not add markdown fences.'))
    })

    test('buildCompactionUserPrompt renders empty transcript fallback', () => {
        const prompt = buildCompactionUserPrompt([])
        assert.ok(prompt.includes('(empty)'))
    })

    test('buildCompactionUserPrompt normalizes tool content and handles unnamed tool message', () => {
        const messages: ChatMessage[] = [
            {
                role: 'assistant',
                content: 'plain assistant text',
            },
            {
                role: 'tool',
                content: [
                    {
                        type: 'tool-result',
                        toolCallId: 'call-2',
                        toolName: '',
                        output: { type: 'text', value: ' \r\nresult line\r\n ' },
                    },
                ],
            },
        ]

        const prompt = buildCompactionUserPrompt(messages)
        assert.ok(prompt.includes('[0] ASSISTANT\nplain assistant text'))
        assert.ok(prompt.includes('[1] TOOL\nresult line'))
        assert.strictEqual(prompt.includes('(undefined)'), false)
    })

    test('selectCompactionMessages returns all messages when budget is sufficient', () => {
        const messages: ChatMessage[] = [
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'second' },
            { role: 'user', content: 'third' },
        ]
        const selected = selectCompactionMessages(messages, 100, (text) => text.length)
        assert.deepStrictEqual(selected, messages)
    })

    test('selectCompactionMessages drops oldest messages under a tight budget', () => {
        const messages: ChatMessage[] = [
            { role: 'user', content: 'oldest' },
            { role: 'assistant', content: 'middle' },
            { role: 'user', content: 'newest' },
        ]
        const selected = selectCompactionMessages(messages, 20, (text) => text.length)
        assert.deepStrictEqual(
            selected.map((m) => m.content),
            ['newest'],
        )
    })

    test('selectCompactionMessages keeps the newest message even when it exceeds the budget', () => {
        const messages: ChatMessage[] = [
            { role: 'user', content: 'old' },
            { role: 'assistant', content: 'x'.repeat(500) },
        ]
        const selected = selectCompactionMessages(messages, 10, (text) => text.length)
        assert.deepStrictEqual(selected, [messages[1]])
    })

    test('selectCompactionMessages returns empty for an empty array', () => {
        assert.deepStrictEqual(
            selectCompactionMessages([], 100, (text) => text.length),
            [],
        )
    })

    test('isContextSummaryMessage only matches user summary prefix with newline', () => {
        const summaryUserMessage: ChatMessage = {
            role: 'user',
            content: `${CONTEXT_SUMMARY_PREFIX}\nsummary body`,
        }
        const missingNewlineUserMessage: ChatMessage = {
            role: 'user',
            content: CONTEXT_SUMMARY_PREFIX,
        }
        const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: `${CONTEXT_SUMMARY_PREFIX}\nsummary body`,
        }

        assert.strictEqual(isContextSummaryMessage(summaryUserMessage), true)
        assert.strictEqual(isContextSummaryMessage(missingNewlineUserMessage), false)
        assert.strictEqual(isContextSummaryMessage(assistantMessage), false)
    })
})
