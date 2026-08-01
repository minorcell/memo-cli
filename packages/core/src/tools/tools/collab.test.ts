import assert from 'node:assert'
import type { MemoToolOutput } from '@memo/core/tools/router/types'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, describe, test } from 'vitest'
import {
    __resetCollabStateForTests,
    closeAgentTool,
    resumeAgentTool,
    sendInputTool,
    spawnAgentTool,
    waitTool,
} from '@memo/core/tools/tools/collab'

let tempDir: string
let prevCommand: string | undefined
let prevMaxAgents: string | undefined

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`)
    await mkdir(dir, { recursive: true })
    return dir
}

function textPayload(result: MemoToolOutput) {
    if (result.type === 'text' || result.type === 'error-text') return result.value ?? ''
    return ''
}

beforeAll(async () => {
    tempDir = await makeTempDir('memo-tools-collab')
    const scriptPath = join(tempDir, 'fake-subagent.cjs')
    const script = `
process.stdin.setEncoding('utf8')
let input = ''
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', () => {
  const msg = input.trim()
  if (msg.startsWith('sleep:')) {
    const ms = Number(msg.slice('sleep:'.length)) || 0
    setTimeout(() => {
      console.log('slept:' + ms)
      process.exit(0)
    }, ms)
    return
  }
  if (msg === 'hang') {
    setInterval(() => {}, 1000)
    return
  }
  if (msg === 'fail') {
    console.error('forced failure')
    process.exit(2)
    return
  }
  if (msg.startsWith('echo:')) {
    console.log(msg.slice('echo:'.length))
    process.exit(0)
    return
  }
  console.log('ok:' + msg)
  process.exit(0)
})
`.trim()
    await writeFile(scriptPath, script, 'utf8')

    prevCommand = process.env.MEMO_SUBAGENT_COMMAND
    prevMaxAgents = process.env.MEMO_SUBAGENT_MAX_AGENTS
    process.env.MEMO_SUBAGENT_COMMAND = `node ${JSON.stringify(scriptPath)}`
    process.env.MEMO_SUBAGENT_MAX_AGENTS = '4'
})

afterEach(async () => {
    await __resetCollabStateForTests()
})

afterAll(async () => {
    if (prevCommand === undefined) {
        delete process.env.MEMO_SUBAGENT_COMMAND
    } else {
        process.env.MEMO_SUBAGENT_COMMAND = prevCommand
    }
    if (prevMaxAgents === undefined) {
        delete process.env.MEMO_SUBAGENT_MAX_AGENTS
    } else {
        process.env.MEMO_SUBAGENT_MAX_AGENTS = prevMaxAgents
    }
    await __resetCollabStateForTests()
    await rm(tempDir, { recursive: true, force: true })
})

describe('collab tools', () => {
    test('spawn + wait reaches completed status and returns final map payload', async () => {
        const spawnResult = await spawnAgentTool.execute({ message: 'echo:hello' })
        assert.strictEqual(spawnResult.type, 'text')
        const spawned = JSON.parse(textPayload(spawnResult))
        assert.strictEqual(spawned.status, 'running')
        assert.ok(typeof spawned.agent_id === 'string' && spawned.agent_id.length > 0)

        const waitResult = await waitTool.execute({ ids: [spawned.agent_id], timeout_ms: 10_000 })
        assert.strictEqual(waitResult.type, 'text')
        const waited = JSON.parse(textPayload(waitResult))
        assert.strictEqual(waited.timed_out, false)
        assert.strictEqual(waited.status[spawned.agent_id], 'completed')
        assert.strictEqual(waited.details[spawned.agent_id].status, 'completed')
        assert.ok(
            typeof waited.details[spawned.agent_id].last_output === 'string' &&
                waited.details[spawned.agent_id].last_output.includes('hello'),
        )
    })

    test('close_agent marks closed and resume_agent restores pre-close status', async () => {
        const spawnResult = await spawnAgentTool.execute({ message: 'echo:first' })
        const spawned = JSON.parse(textPayload(spawnResult))
        const agentId = spawned.agent_id as string

        await waitTool.execute({ ids: [agentId], timeout_ms: 10_000 })

        const closeResult = await closeAgentTool.execute({ id: agentId })
        const closed = JSON.parse(textPayload(closeResult))
        assert.strictEqual(closed.status, 'closed')

        const sendWhileClosed = await sendInputTool.execute({
            id: agentId,
            message: 'echo:second',
        })
        assert.strictEqual(sendWhileClosed.type, 'error-text')
        assert.ok(textPayload(sendWhileClosed).includes('resume_agent'))

        const resumeResult = await resumeAgentTool.execute({ id: agentId })
        const resumed = JSON.parse(textPayload(resumeResult))
        assert.strictEqual(resumed.status, 'completed')

        const sendAfterResume = await sendInputTool.execute({
            id: agentId,
            message: 'echo:second',
        })
        assert.strictEqual(sendAfterResume.type, 'text')
    })

    test('wait returns not_found immediately for unknown agents', async () => {
        const waitResult = await waitTool.execute({
            ids: ['missing-agent-id'],
            timeout_ms: 10_000,
        })
        const waited = JSON.parse(textPayload(waitResult))
        assert.strictEqual(waited.timed_out, false)
        assert.strictEqual(waited.status['missing-agent-id'], 'not_found')
        assert.strictEqual(waited.details['missing-agent-id'].status, 'not_found')
        assert.strictEqual(waited.details['missing-agent-id'].last_output, null)
    })

    test('spawn_agent respects MEMO_SUBAGENT_MAX_AGENTS limit', async () => {
        process.env.MEMO_SUBAGENT_MAX_AGENTS = '1'
        const first = await spawnAgentTool.execute({ message: 'sleep:5000' })
        assert.strictEqual(first.type, 'text')

        const second = await spawnAgentTool.execute({ message: 'echo:blocked' })
        assert.strictEqual(second.type, 'error-text')
        assert.ok(textPayload(second).includes('concurrency limit'))
    })

    test('wait validates timeout and mutating tools report missing agents', async () => {
        const invalidTimeout = await waitTool.execute({ ids: ['missing'], timeout_ms: 0 })
        assert.strictEqual(invalidTimeout.type, 'error-text')
        assert.ok(textPayload(invalidTimeout).includes('timeout_ms'))

        const sendResult = await sendInputTool.execute({ id: 'missing', message: 'x' })
        assert.strictEqual(sendResult.type, 'error-text')
        assert.ok(textPayload(sendResult).includes('agent not found'))

        const closeResult = await closeAgentTool.execute({ id: 'missing' })
        assert.strictEqual(closeResult.type, 'error-text')

        const resumeResult = await resumeAgentTool.execute({ id: 'missing' })
        assert.strictEqual(resumeResult.type, 'error-text')
    })
})
