/** @file Session Hook & Middleware 行为测试。 */
import assert from 'node:assert'
import { describe, test } from 'bun:test'
import { z } from 'zod'
import { createAgentSession, createTokenCounter } from '@memo/core'
import type { McpTool } from '@memo/tools/tools/types'

const echoTool: McpTool<{ text: string }> = {
    name: 'echo',
    description: 'echo input',
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }) => ({
        content: [{ type: 'text', text: `echo:${text}` }],
    }),
}

describe('session hooks & middleware', () => {
    test('invokes hooks and middlewares in order', async () => {
        const outputs = ['```json\n{"tool":"echo","input":{"text":"foo"}}\n```', '{"final":"done"}']
        const hookLog: string[] = []
        const session = await createAgentSession(
            {
                tools: { echo: echoTool },
                callLLM: async () => ({
                    content: outputs.shift() ?? JSON.stringify({ final: 'done' }),
                }),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                hooks: {
                    onTurnStart: ({ turn }) => {
                        hookLog.push(`hook:start:${turn}`)
                    },
                    onAction: ({ step, action }) => {
                        hookLog.push(`hook:action:${step}:${action.tool}`)
                    },
                    onObservation: ({ step, tool, observation }) => {
                        hookLog.push(`hook:obs:${step}:${tool}:${observation}`)
                    },
                    onFinal: ({ status, finalText }) => {
                        hookLog.push(`hook:final:${status}:${finalText}`)
                    },
                },
                middlewares: [
                    {
                        onTurnStart: ({ turn }) => {
                            hookLog.push(`mw:start:${turn}`)
                        },
                        onAction: ({ step, action }) => {
                            hookLog.push(`mw:action:${step}:${action.tool}`)
                        },
                        onObservation: ({ step, tool, observation }) => {
                            hookLog.push(`mw:obs:${step}:${tool}:${observation}`)
                        },
                        onFinal: ({ status, finalText }) => {
                            hookLog.push(`mw:final:${status}:${finalText}`)
                        },
                    },
                ],
            },
            { maxSteps: 4 },
        )
        try {
            const result = await session.runTurn('question')
            assert.strictEqual(result.finalText, 'done')
            assert.deepStrictEqual(hookLog, [
                'hook:start:1',
                'mw:start:1',
                'hook:action:0:echo',
                'mw:action:0:echo',
                'hook:obs:0:echo:echo:foo',
                'mw:obs:0:echo:echo:foo',
                'hook:final:ok:done',
                'mw:final:ok:done',
            ])
        } finally {
            await session.close()
        }
    })
})
