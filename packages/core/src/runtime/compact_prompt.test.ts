import assert from 'node:assert'
import { describe, test } from 'vitest'
import type { ChatMessage } from '@memo/core/types'
import {
    buildCompactionUserPrompt,
    CONTEXT_SUMMARY_PREFIX,
    isContextSummaryMessage,
} from '@memo/core/runtime/compact_prompt'

describe('compact_prompt', () => {
    test('buildCompactionUserPrompt formats assistant tool calls and tool messages', () => {
        const longToolOutput = 'x'.repeat(4_005)
        const messages: ChatMessage[] = [
            {
                role: 'assistant',
                content: 'planning',
                tool_calls: [
                    {
                        id: 'call-1',
                        type: 'function',
                        function: {
                            name: 'exec_command',
                            arguments: '{}',
                        },
                    },
                ],
            },
            {
                role: 'tool',
                content: longToolOutput,
                tool_call_id: 'call-1',
                name: 'exec_command',
            },
        ]

        const prompt = buildCompactionUserPrompt(messages)
        assert.ok(prompt.includes('[0] ASSISTANT (tool_calls: exec_command)'))
        assert.ok(prompt.includes('[1] TOOL (exec_command)'))
        assert.ok(prompt.includes(`${'x'.repeat(4_000)}...`))
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
                content: ' \r\nresult line\r\n ',
                tool_call_id: 'call-2',
            },
        ]

        const prompt = buildCompactionUserPrompt(messages)
        assert.ok(prompt.includes('[0] ASSISTANT\nplain assistant text'))
        assert.ok(prompt.includes('[1] TOOL\nresult line'))
        assert.strictEqual(prompt.includes('(undefined)'), false)
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
