import { describe, expect, test } from 'vitest'
import {
    createAgentSession,
    createTokenCounter,
    SessionBusyError,
    SessionClosedError,
    type LLMResult,
} from '@memo/core'
import { emptyUsage } from '@memo/core/utils/usage'

function response(text: string): LLMResult {
    return {
        text,
        toolCalls: [],
        toolResults: [],
        usage: emptyUsage(),
        finishReason: 'stop',
    }
}

function deferredResponse() {
    let resolve!: (value: LLMResult) => void
    const promise = new Promise<LLMResult>((next) => {
        resolve = next
    })
    return { promise, resolve }
}

describe('AgentSession operation boundaries', () => {
    test('rejects a second turn and manual compaction while a turn is running', async () => {
        const pending = deferredResponse()
        const session = await createAgentSession({
            callLLM: async () => pending.promise,
            historySinks: [],
            loadPrompt: async () => 'system',
            tokenCounter: createTokenCounter(),
            tools: {},
        })

        const running = session.runTurn('first')
        await expect(session.runTurn('second')).rejects.toBeInstanceOf(SessionBusyError)
        await expect(session.compactHistory('manual')).rejects.toBeInstanceOf(SessionBusyError)

        pending.resolve(response('done'))
        await expect(running).resolves.toMatchObject({ finalText: 'done' })
        await session.close()
    })

    test('rejects a turn while manual compaction is running', async () => {
        const pending = deferredResponse()
        let callCount = 0
        const session = await createAgentSession({
            callLLM: async () => {
                callCount += 1
                return callCount === 1 ? response('seeded') : pending.promise
            },
            historySinks: [],
            loadPrompt: async () => 'system',
            tokenCounter: createTokenCounter(),
            tools: {},
        })

        await session.runTurn('seed')
        const compacting = session.compactHistory('manual')
        await expect(session.runTurn('overlap')).rejects.toBeInstanceOf(SessionBusyError)

        pending.resolve(response('summary'))
        await expect(compacting).resolves.toMatchObject({ status: 'success' })
        await session.close()
    })

    test('close waits for the active operation and rejects new work', async () => {
        const pending = deferredResponse()
        const session = await createAgentSession({
            callLLM: async () => pending.promise,
            historySinks: [],
            loadPrompt: async () => 'system',
            tokenCounter: createTokenCounter(),
            tools: {},
        })

        const running = session.runTurn('first')
        const closing = session.close()

        await expect(session.runTurn('second')).rejects.toBeInstanceOf(SessionClosedError)
        await expect(session.compactHistory('manual')).rejects.toBeInstanceOf(SessionClosedError)

        pending.resolve(response('done'))
        await running
        await closing
    })
})
