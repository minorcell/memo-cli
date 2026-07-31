import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { defineMcpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'
import { getRuntimeCwd } from '@memo/tools/runtime/context'

type AgentStatus = 'running' | 'completed' | 'errored' | 'closed'
type WaitStatus = AgentStatus | 'not_found'
type WaitDetail = {
    status: WaitStatus
    last_message: string | null
    last_output: string | null
    last_error: string | null
    last_submission_id: string | null
    updated_at: string | null
}

type RunningSubmission = {
    id: string
    message: string
    process: ChildProcessWithoutNullStreams
    startedAt: string
    interrupted: boolean
}

type AgentRecord = {
    id: string
    createdAt: string
    updatedAt: string
    status: AgentStatus
    statusBeforeClose: AgentStatus
    lastMessage: string
    lastSubmissionId: string | null
    lastOutput: string | null
    lastError: string | null
    running: RunningSubmission | null
}

const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const MIN_WAIT_TIMEOUT_MS = 10_000
const MAX_WAIT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_AGENTS = 4
const TERMINATE_GRACE_MS = 1_500
const MAX_OUTPUT_PREVIEW_CHARS = 2_000

const agents = new Map<string, AgentRecord>()

const SPAWN_AGENT_INPUT_SCHEMA = z
    .object({
        message: z.string().min(1),
        agent_type: z.string().optional(),
    })
    .strict()

const SEND_INPUT_INPUT_SCHEMA = z
    .object({
        id: z.string().min(1),
        message: z.string().min(1),
        interrupt: z.boolean().optional(),
    })
    .strict()

const RESUME_AGENT_INPUT_SCHEMA = z
    .object({
        id: z.string().min(1),
    })
    .strict()

const WAIT_INPUT_SCHEMA = z
    .object({
        ids: z.array(z.string().min(1)).min(1),
        timeout_ms: z.number().int().positive().optional(),
    })
    .strict()

const CLOSE_AGENT_INPUT_SCHEMA = z
    .object({
        id: z.string().min(1),
    })
    .strict()

type SpawnInput = z.infer<typeof SPAWN_AGENT_INPUT_SCHEMA>
type SendInput = z.infer<typeof SEND_INPUT_INPUT_SCHEMA>
type ResumeInput = z.infer<typeof RESUME_AGENT_INPUT_SCHEMA>
type WaitInput = z.infer<typeof WAIT_INPUT_SCHEMA>
type CloseInput = z.infer<typeof CLOSE_AGENT_INPUT_SCHEMA>

function nowIso() {
    return new Date().toISOString()
}

function buildMissingAgentError(id: string) {
    return textResult(`agent not found: ${id}`, true)
}

function parseMaxAgents() {
    const raw = process.env.MEMO_SUBAGENT_MAX_AGENTS?.trim()
    if (!raw) return DEFAULT_MAX_AGENTS
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_AGENTS
    return Math.floor(parsed)
}

function runningAgentCount() {
    let count = 0
    for (const record of agents.values()) {
        if (record.running) count += 1
    }
    return count
}

function resolveSubagentCommand() {
    const explicit = process.env.MEMO_SUBAGENT_COMMAND?.trim()
    if (explicit) return explicit

    const distEntry = resolve(getRuntimeCwd(), 'dist/index.js')
    if (existsSync(distEntry)) {
        return `node ${JSON.stringify(distEntry)} --dangerous`
    }

    return 'memo --dangerous'
}

function isFinalStatus(status: WaitStatus) {
    return status !== 'running'
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
    })
}

function clampWaitTimeout(raw?: number): number | null {
    if (raw === undefined) return DEFAULT_WAIT_TIMEOUT_MS
    if (raw <= 0) return null
    return Math.max(MIN_WAIT_TIMEOUT_MS, Math.min(MAX_WAIT_TIMEOUT_MS, raw))
}

function truncateOutput(text: string) {
    if (text.length <= MAX_OUTPUT_PREVIEW_CHARS) return text
    return `${text.slice(0, MAX_OUTPUT_PREVIEW_CHARS)}\n...[truncated]`
}

function compactOutput(stdout: string, stderr: string) {
    const pieces: string[] = []
    const out = stdout.trim()
    const err = stderr.trim()
    if (out) pieces.push(out)
    if (err) pieces.push(`stderr:\n${err}`)
    return truncateOutput(pieces.join('\n\n'))
}

async function terminateRunningSubmission(record: AgentRecord) {
    const running = record.running
    if (!running) return
    running.interrupted = true
    const proc = running.process

    if (proc.exitCode !== null || proc.killed) return

    await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
            if (settled) return
            settled = true
            clearTimeout(killTimer)
            proc.off('close', finish)
            resolve()
        }
        const killTimer = setTimeout(() => {
            if (proc.exitCode === null) {
                try {
                    proc.kill('SIGKILL')
                } catch {
                    finish()
                }
            }
        }, TERMINATE_GRACE_MS)
        proc.on('close', finish)
        try {
            proc.kill('SIGTERM')
        } catch {
            finish()
        }
    })
}

function getWaitStatus(id: string): WaitStatus {
    const record = agents.get(id)
    if (!record) return 'not_found'
    return record.status
}

function getWaitDetail(id: string): WaitDetail {
    const record = agents.get(id)
    if (!record) {
        return {
            status: 'not_found',
            last_message: null,
            last_output: null,
            last_error: null,
            last_submission_id: null,
            updated_at: null,
        }
    }
    return {
        status: record.status,
        last_message: record.lastMessage,
        last_output: record.lastOutput,
        last_error: record.lastError,
        last_submission_id: record.lastSubmissionId,
        updated_at: record.updatedAt,
    }
}

function buildAgentSummary(record: AgentRecord) {
    return {
        agent_id: record.id,
        status: record.status,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        last_message: record.lastMessage,
        last_submission_id: record.lastSubmissionId,
        has_last_output: Boolean(record.lastOutput),
        has_last_error: Boolean(record.lastError),
    }
}

function finalizeSubmission(params: {
    record: AgentRecord
    submissionId: string
    stdout: string
    stderr: string
    exitCode: number
    interrupted: boolean
}) {
    const { record, submissionId, stdout, stderr, exitCode, interrupted } = params
    if (!record.running || record.running.id !== submissionId) {
        return
    }

    record.running = null
    record.updatedAt = nowIso()
    record.lastOutput = compactOutput(stdout, stderr) || null
    record.lastError = null

    if (record.status === 'closed') {
        return
    }

    if (interrupted) {
        record.status = 'errored'
        record.lastError = 'interrupted'
        record.statusBeforeClose = 'errored'
        return
    }

    if (exitCode === 0) {
        record.status = 'completed'
        record.statusBeforeClose = 'completed'
        return
    }

    record.status = 'errored'
    record.lastError = `submission failed with exit code ${exitCode}`
    record.statusBeforeClose = 'errored'
}

async function startSubmission(record: AgentRecord, message: string): Promise<string> {
    const maxAgents = parseMaxAgents()
    if (runningAgentCount() >= maxAgents) {
        throw new Error(`subagent concurrency limit reached (${maxAgents})`)
    }

    const submissionId = crypto.randomUUID()
    const command = resolveSubagentCommand()
    const proc = spawn(command, {
        cwd: getRuntimeCwd(),
        env: {
            ...process.env,
        },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []

    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk) => stdoutChunks.push(chunk))
    proc.stderr?.on('data', (chunk) => stderrChunks.push(chunk))
    proc.on('error', (err) => {
        stderrChunks.push(`[spawn error] ${(err as Error).message}`)
    })

    record.running = {
        id: submissionId,
        message,
        process: proc,
        startedAt: nowIso(),
        interrupted: false,
    }
    record.status = 'running'
    record.lastMessage = message
    record.lastSubmissionId = submissionId
    record.updatedAt = nowIso()

    proc.on('close', (code) => {
        const exitCode = typeof code === 'number' ? code : -1
        const interrupted = Boolean(record.running?.id === submissionId && record.running.interrupted)
        finalizeSubmission({
            record,
            submissionId,
            stdout: stdoutChunks.join(''),
            stderr: stderrChunks.join(''),
            exitCode,
            interrupted,
        })
    })

    try {
        proc.stdin?.write(`${message.trim()}\n`)
    } catch {
        // ignore short-lived stdin errors; close handler will report final status
    }
    try {
        proc.stdin?.end()
    } catch {
        // ignore
    }

    return submissionId
}

export async function __resetCollabStateForTests() {
    const tasks: Promise<void>[] = []
    for (const record of agents.values()) {
        tasks.push(terminateRunningSubmission(record))
    }
    await Promise.allSettled(tasks)
    agents.clear()
}

export const spawnAgentTool = defineMcpTool<SpawnInput>({
    name: 'spawn_agent',
    description: 'Spawn a sub-agent for a well-scoped task and return the agent id.',
    inputSchema: SPAWN_AGENT_INPUT_SCHEMA,
    supportsParallelToolCalls: false,
    isMutating: true,
    execute: async ({ message }) => {
        const trimmed = message.trim()
        if (!trimmed) {
            return textResult(`spawn_agent failed: message must not be empty`, true)
        }

        const id = crypto.randomUUID()
        const createdAt = nowIso()
        const record: AgentRecord = {
            id,
            createdAt,
            updatedAt: createdAt,
            status: 'running',
            statusBeforeClose: 'completed',
            lastMessage: trimmed,
            lastSubmissionId: null,
            lastOutput: null,
            lastError: null,
            running: null,
        }
        agents.set(id, record)

        try {
            const submissionId = await startSubmission(record, trimmed)
            return textResult(
                JSON.stringify(
                    {
                        ...buildAgentSummary(record),
                        submission_id: submissionId,
                    },
                    null,
                    2,
                ),
            )
        } catch (err) {
            agents.delete(id)
            return textResult(`spawn_agent failed: ${(err as Error).message}`, true)
        }
    },
})

export const sendInputTool = defineMcpTool<SendInput>({
    name: 'send_input',
    description: 'Send a message to an existing agent.',
    inputSchema: SEND_INPUT_INPUT_SCHEMA,
    supportsParallelToolCalls: false,
    isMutating: true,
    execute: async ({ id, message, interrupt }) => {
        const record = agents.get(id)
        if (!record) return buildMissingAgentError(id)

        const trimmed = message.trim()
        if (!trimmed) {
            return textResult(`send_input failed: message must not be empty`, true)
        }

        if (record.status === 'closed') {
            return textResult(`send_input failed: agent ${id} is closed; run resume_agent first`, true)
        }

        if (record.running) {
            if (!interrupt) {
                return textResult(
                    `send_input failed: agent ${id} is busy; set interrupt=true to cancel current submission`,
                    true,
                )
            }
            await terminateRunningSubmission(record)
        }

        try {
            const submissionId = await startSubmission(record, trimmed)
            return textResult(
                JSON.stringify(
                    {
                        agent_id: record.id,
                        status: record.status,
                        submission_id: submissionId,
                    },
                    null,
                    2,
                ),
            )
        } catch (err) {
            return textResult(`send_input failed: ${(err as Error).message}`, true)
        }
    },
})

export const resumeAgentTool = defineMcpTool<ResumeInput>({
    name: 'resume_agent',
    description: 'Resume a previously closed agent by id.',
    inputSchema: RESUME_AGENT_INPUT_SCHEMA,
    supportsParallelToolCalls: false,
    isMutating: true,
    execute: async ({ id }) => {
        const record = agents.get(id)
        if (!record) return buildMissingAgentError(id)

        if (record.status === 'closed') {
            record.status = record.statusBeforeClose
            record.updatedAt = nowIso()
        }

        return textResult(
            JSON.stringify(
                {
                    agent_id: id,
                    status: record.status,
                },
                null,
                2,
            ),
        )
    },
})

export const waitTool = defineMcpTool<WaitInput>({
    name: 'wait',
    description: 'Wait for agent statuses and return current snapshots.',
    inputSchema: WAIT_INPUT_SCHEMA,
    supportsParallelToolCalls: false,
    isMutating: false,
    execute: async ({ ids, timeout_ms }) => {
        const resolvedTimeout = clampWaitTimeout(timeout_ms)
        if (resolvedTimeout === null) {
            return textResult(`wait failed: timeout_ms must be greater than zero`, true)
        }

        const collectFinals = () => {
            const status: Record<string, WaitStatus> = {}
            const details: Record<string, WaitDetail> = {}
            for (const id of ids) {
                const current = getWaitStatus(id)
                if (isFinalStatus(current)) {
                    status[id] = current
                    details[id] = getWaitDetail(id)
                }
            }
            return { status, details }
        }

        let finalSnapshots = collectFinals()
        if (Object.keys(finalSnapshots.status).length > 0) {
            return textResult(
                JSON.stringify(
                    {
                        status: finalSnapshots.status,
                        details: finalSnapshots.details,
                        timed_out: false,
                    },
                    null,
                    2,
                ),
            )
        }

        const deadline = Date.now() + resolvedTimeout
        while (Date.now() < deadline) {
            await sleep(100)
            finalSnapshots = collectFinals()
            if (Object.keys(finalSnapshots.status).length > 0) {
                return textResult(
                    JSON.stringify(
                        {
                            status: finalSnapshots.status,
                            details: finalSnapshots.details,
                            timed_out: false,
                        },
                        null,
                        2,
                    ),
                )
            }
        }

        return textResult(
            JSON.stringify(
                {
                    status: {},
                    details: {},
                    timed_out: true,
                },
                null,
                2,
            ),
        )
    },
})

export const closeAgentTool = defineMcpTool<CloseInput>({
    name: 'close_agent',
    description: 'Close an agent and return its last known status.',
    inputSchema: CLOSE_AGENT_INPUT_SCHEMA,
    supportsParallelToolCalls: false,
    isMutating: true,
    execute: async ({ id }) => {
        const record = agents.get(id)
        if (!record) return buildMissingAgentError(id)

        if (record.status === 'closed') {
            return textResult(
                JSON.stringify(
                    {
                        agent_id: id,
                        status: 'closed',
                    },
                    null,
                    2,
                ),
            )
        }

        record.statusBeforeClose = record.running ? 'completed' : record.status
        record.status = 'closed'
        record.updatedAt = nowIso()
        await terminateRunningSubmission(record)

        return textResult(
            JSON.stringify(
                {
                    agent_id: id,
                    status: 'closed',
                },
                null,
                2,
            ),
        )
    },
})
