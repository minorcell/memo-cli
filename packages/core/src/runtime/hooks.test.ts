import { beforeAll, afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { $ } from 'bun'
import { z } from 'zod'
import { createAgentSession, createTokenCounter } from '@memo/core'
import type { AgentSession } from '@memo/core'

let tempHome: string
let previousHome: string | undefined

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`)
    await $`mkdir -p ${dir}`
    return dir
}

async function removeDir(dir: string) {
    await $`rm -rf ${dir}`
}

describe('hook middleware chain', () => {
    let session: AgentSession | undefined

    beforeAll(async () => {
        tempHome = await makeTempDir('memo-core-hooks')
        previousHome = process.env.MEMO_HOME
        process.env.MEMO_HOME = tempHome
    })

    afterAll(async () => {
        if (session) {
            await session.close()
        }
        if (previousHome === undefined) {
            delete process.env.MEMO_HOME
        } else {
            process.env.MEMO_HOME = previousHome
        }
        await removeDir(tempHome)
    })

    test('runs optional hooks in order with middleware', async () => {
        const calls: string[] = []
        let llmStep = 0

        session = await createAgentSession(
            {
                tools: {
                    echo: {
                        name: 'echo',
                        description: 'echo text',
                        inputSchema: z.object({ text: z.string() }),
                        async execute(input) {
                            return { content: [{ type: 'text', text: `echo:${input.text}` }] } as any
                        },
                    },
                },
                callLLM: async () => {
                    llmStep += 1
                    if (llmStep === 1) {
                        return JSON.stringify({ tool: 'echo', input: { text: 'hello' } })
                    }
                    return JSON.stringify({ final: 'done' })
                },
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
                onTurnStart: [
                    ({ turn, input }) => {
                        calls.push(`start:${turn}:${input}`)
                    },
                    async (next, payload) => {
                        calls.push('start-mw-before')
                        await next()
                        calls.push('start-mw-after')
                    },
                ],
                onAction: ({ tool, input }) => {
                    calls.push(`action:${tool}:${JSON.stringify(input)}`)
                },
                onObservation: [
                    ({ observation }) => {
                        calls.push(`ob:${observation}`)
                    },
                    async (next) => {
                        calls.push('ob-mw-before')
                        await next()
                        calls.push('ob-mw-after')
                    },
                ],
                onFinal: ({ final, status }) => {
                    calls.push(`final:${final}:${status}`)
                },
            },
            { mode: 'once' },
        )

        const result = await session.runTurn('hi')
        expect(result.finalText).toBe('done')
        expect(calls).toEqual([
            'start:1:hi',
            'start-mw-before',
            'start-mw-after',
            'action:echo:{"text":"hello"}',
            'ob:echo:hello',
            'ob-mw-before',
            'ob-mw-after',
            'final:done:ok',
        ])
    })
})
