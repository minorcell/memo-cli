import { describe, expect, test, vi } from 'vitest'
import type { HistorySink } from '@memo/core/types'
import { emitEventToSinks } from '@memo/core/agent/loop'
import { buildMissingToolResultMessages, parseTextToolCall, toToolHistoryMessage } from '@memo/core/agent/messages'

describe('emitEventToSinks', () => {
    test('writes structured error payload to stderr when sink append fails', async () => {
        const writes: string[] = []
        const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
            writes.push(String(chunk))
            return true
        }) as typeof process.stderr.write)

        const failingSink: HistorySink = {
            append: async () => {
                throw new Error('disk full')
            },
        }

        try {
            await emitEventToSinks(
                {
                    ts: '2026-01-01T00:00:00.000Z',
                    sessionId: 's-1',
                    type: 'assistant',
                    content: 'hello',
                },
                [failingSink],
            )
        } finally {
            writeSpy.mockRestore()
        }

        expect(writes.length).toBeGreaterThan(0)
        const parsed = JSON.parse(writes.join('').trim()) as Record<string, unknown>
        expect(parsed.level).toBe('error')
        expect(parsed.event).toBe('history_sink_append_failed')
        expect(parsed.message).toBe('disk full')
        expect(parsed.sink).toBe('Object')
    })
})

describe('parseTextToolCall', () => {
    const tools = {
        read_file: {} as never,
        exec_command: {} as never,
    }

    test('parses plain json tool call', () => {
        const parsed = parseTextToolCall('{"tool":"read_file","input":{"path":"a.txt"}}', tools)
        expect(parsed).toEqual({
            tool: 'read_file',
            input: { path: 'a.txt' },
        })
    })

    test('parses fenced json tool call', () => {
        const parsed = parseTextToolCall('```json\n{"tool":"exec_command","input":{"cmd":"ls"}}\n```', tools)
        expect(parsed).toEqual({
            tool: 'exec_command',
            input: { cmd: 'ls' },
        })
    })

    test('returns null for unknown or invalid tool payload', () => {
        expect(parseTextToolCall('{"tool":"unknown","input":{}}', tools)).toBeNull()
        expect(parseTextToolCall('{"tool":"read_file"', tools)).toBeNull()
        expect(parseTextToolCall('not-json', tools)).toBeNull()
        expect(parseTextToolCall('   ', tools)).toBeNull()
    })
})

describe('tool result helpers', () => {
    test('toToolHistoryMessage maps tool result part into tool chat message', () => {
        const message = toToolHistoryMessage({
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read_file',
            output: { type: 'text', value: 'content' },
        })
        expect(message).toEqual({
            role: 'tool',
            content: [
                {
                    type: 'tool-result',
                    toolCallId: 'call-1',
                    toolName: 'read_file',
                    output: { type: 'text', value: 'content' },
                },
            ],
        })
    })
})

describe('buildMissingToolResultMessages', () => {
    test('returns empty when every tool call has a matching result', () => {
        const toolCalls = [
            { type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', input: {} },
            { type: 'tool-call', toolCallId: 'c2', toolName: 'exec', input: {} },
        ] as never
        const toolResults = [
            { type: 'tool-result', toolCallId: 'c1', toolName: 'read_file', output: { type: 'text', value: 'ok' } },
            { type: 'tool-result', toolCallId: 'c2', toolName: 'exec', output: { type: 'text', value: 'ok' } },
        ] as never
        expect(buildMissingToolResultMessages(toolCalls, toolResults)).toEqual([])
    })

    test('backfills a synthetic error result for an orphan tool call', () => {
        const toolCalls = [
            { type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', input: {} },
            { type: 'tool-call', toolCallId: 'c2', toolName: 'lost_tool', input: {} },
        ] as never
        const toolResults = [
            { type: 'tool-result', toolCallId: 'c1', toolName: 'read_file', output: { type: 'text', value: 'ok' } },
        ] as never
        const messages = buildMissingToolResultMessages(toolCalls, toolResults)
        expect(messages).toHaveLength(1)
        expect(messages[0]).toEqual({
            role: 'tool',
            content: [
                {
                    type: 'tool-result',
                    toolCallId: 'c2',
                    toolName: 'lost_tool',
                    output: { type: 'error-text', value: expect.stringContaining('Tool result missing') },
                },
            ],
        })
    })

    test('skips provider-executed tool calls', () => {
        const toolCalls = [
            { type: 'tool-call', toolCallId: 'c1', toolName: 'server_tool', input: {}, providerExecuted: true },
        ] as never
        expect(buildMissingToolResultMessages(toolCalls, [])).toEqual([])
    })
})
