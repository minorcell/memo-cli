import { describe, expect, test, vi } from 'vitest'
import type { HistorySink } from '@memo/core/types'
import {
    accumulateUsage,
    emitEventToSinks,
    emptyUsage,
    fallbackSessionTitleFromPrompt,
    isAbortError,
    normalizeSessionTitle,
    stableStringify,
    truncateSessionTitle,
} from '@memo/core/agent/loop'
import { parseTextToolCall, toToolHistoryMessage } from '@memo/core/agent/messages'

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

describe('stableStringify', () => {
    test('serializes self-referencing object without throwing', () => {
        const root: Record<string, unknown> = {}
        root.self = root

        const serialized = stableStringify(root)
        expect(serialized).toBe('{"self":"[Circular]"}')
    })

    test('serializes indirect circular references with circular marker', () => {
        const parent: Record<string, unknown> = { name: 'parent' }
        const child: Record<string, unknown> = { name: 'child', parent }
        parent.child = child

        const serialized = stableStringify(parent)
        expect(serialized).toContain('"child":{"name":"child","parent":"[Circular]"}')
        expect(serialized).toContain('"name":"parent"')
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

describe('session title helpers', () => {
    test('truncateSessionTitle appends ellipsis when exceeding max', () => {
        const truncated = truncateSessionTitle('x'.repeat(80))
        expect(truncated.endsWith('...')).toBe(true)
        expect(truncated.length).toBe(60)
    })

    test('normalizeSessionTitle strips quotes and whitespace', () => {
        expect(normalizeSessionTitle('  "  Hello\nWorld  "  ')).toBe('Hello World')
        expect(normalizeSessionTitle('   ')).toBe('')
    })

    test('normalizeSessionTitle removes think tags and title prefixes', () => {
        expect(
            normalizeSessionTitle(
                '<think>internal</think> Title: "Build REST API migration plan" <thinking>secret</thinking>',
            ),
        ).toBe('Build REST API migration plan')
    })

    test('fallbackSessionTitleFromPrompt handles empty/cjk/word prompts', () => {
        expect(fallbackSessionTitleFromPrompt('   ')).toBe('New Session')
        expect(fallbackSessionTitleFromPrompt('这是一个非常非常长的中文标题用于测试截断行为')).toBe(
            '这是一个非常非常长的中文标题用于测试截断...',
        )
        expect(fallbackSessionTitleFromPrompt('build a rest api using express and sqlite quickly')).toBe(
            'build a rest api using express and sqlite',
        )
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

describe('isAbortError', () => {
    test('detects abort error by name and message', () => {
        const abortError = new Error('cancelled')
        abortError.name = 'AbortError'
        const abortedMessageError = new Error('Request was aborted.')
        expect(isAbortError(abortError)).toBe(true)
        expect(isAbortError(abortedMessageError)).toBe(true)
        expect(isAbortError(new Error('other'))).toBe(false)
        expect(isAbortError('AbortError')).toBe(false)
    })
})
