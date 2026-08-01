import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { guardDangerousCommand, splitStdinLines, trimPendingStdinBuffer } from '@memo/core/tools/tools/command_guard'
import { getRuntimeCwd } from '@memo/core/tools/runtime/context'

const DEFAULT_EXEC_YIELD_TIME_MS = 10_000
const DEFAULT_WRITE_YIELD_TIME_MS = 250
const DEFAULT_MAX_OUTPUT_TOKENS = 2_000
const MAX_SESSIONS = 64

type StartExecRequest = {
    cmd: string
    workdir?: string
    shell?: string
    login?: boolean
    tty?: boolean
    yield_time_ms?: number
    execution_timeout_ms?: number
    max_output_tokens?: number
    source_tool?: string
}

type WriteStdinRequest = {
    session_id: number
    chars?: string
    yield_time_ms?: number
    max_output_tokens?: number
    source_tool?: string
}

type SessionState = {
    id: number
    output: string
    readOffset: number
    pendingStdinInput: string
    startedAtMs: number
    exited: boolean
    exitCode: number | null
    eventBus: EventEmitter
    proc: ReturnType<typeof spawn>
}

type SessionResponse = {
    sessionId: number
    chunkId: string
    wallTimeSeconds: number
    exitCode: number | null
    output: string
    originalTokenCount: number
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
}

function formatChunkId() {
    const raw = Math.random().toString(16).slice(2)
    return raw || String(Date.now())
}

function toShellInvocation(params: { cmd: string; shell?: string; login: boolean }): {
    file: string
    args: string[]
} {
    const login = params.login
    const shell = params.shell?.trim()

    if (process.platform === 'win32') {
        const chosen = shell || 'powershell.exe'
        if (chosen.toLowerCase().includes('powershell')) {
            return {
                file: chosen,
                args: ['-NoProfile', '-Command', params.cmd],
            }
        }
        return {
            file: chosen,
            args: [login ? '-lc' : '-c', params.cmd],
        }
    }

    const chosen = shell || process.env.SHELL || '/bin/bash'
    return {
        file: chosen,
        args: [login ? '-lc' : '-c', params.cmd],
    }
}

function truncateByTokens(text: string, maxOutputTokens?: number) {
    const maxTokens =
        typeof maxOutputTokens === 'number' && maxOutputTokens > 0
            ? Math.floor(maxOutputTokens)
            : DEFAULT_MAX_OUTPUT_TOKENS

    const maxChars = maxTokens * 4
    const originalTokenCount = estimateTokens(text)

    if (text.length <= maxChars) {
        return {
            output: text,
            originalTokenCount,
            deliveredChars: text.length,
        }
    }

    return {
        output: text.slice(0, maxChars),
        originalTokenCount,
        deliveredChars: maxChars,
    }
}

function formatSessionResponse(response: SessionResponse): string {
    const sections: string[] = []
    sections.push(`Chunk ID: ${response.chunkId}`)
    sections.push(`Wall time: ${response.wallTimeSeconds.toFixed(4)} seconds`)
    if (response.exitCode !== null) {
        sections.push(`Process exited with code ${response.exitCode}`)
    } else {
        sections.push(`Process running with session ID ${response.sessionId}`)
    }
    sections.push(`Original token count: ${response.originalTokenCount}`)
    sections.push('Output:')
    sections.push(response.output)
    return sections.join('\n')
}

function clampYield(input: number | undefined, fallback: number): number {
    if (typeof input !== 'number' || Number.isNaN(input)) return fallback
    if (input < 0) return 0
    return Math.floor(input)
}

async function waitForWindow(session: SessionState, yieldMs: number): Promise<void> {
    if (yieldMs <= 0 || session.exited) return
    await new Promise<void>((resolve) => {
        let settled = false
        const finalize = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            cleanup()
            resolve()
        }
        const onExit = () => {
            finalize()
        }
        const cleanup = () => {
            session.eventBus.off('exit', onExit)
        }
        const timer = setTimeout(() => {
            finalize()
        }, yieldMs)
        timer.unref?.()
        session.eventBus.on('exit', onExit)
    })
}

async function waitForExit(session: SessionState, timeoutMs: number): Promise<void> {
    if (session.exited || timeoutMs <= 0) return
    await new Promise<void>((resolve) => {
        let settled = false
        const finalize = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            cleanup()
            resolve()
        }
        const onExit = () => {
            finalize()
        }
        const cleanup = () => {
            session.eventBus.off('exit', onExit)
        }
        const timer = setTimeout(() => {
            finalize()
        }, timeoutMs)
        timer.unref?.()
        session.eventBus.on('exit', onExit)
    })
}

class UnifiedExecManager {
    private sessions = new Map<number, SessionState>()
    private nextId = 1

    private cleanupSessions() {
        if (this.sessions.size <= MAX_SESSIONS) return
        const ended = Array.from(this.sessions.values())
            .filter((session) => session.exited)
            .sort((a, b) => a.startedAtMs - b.startedAtMs)

        for (const session of ended) {
            if (this.sessions.size <= MAX_SESSIONS) break
            this.sessions.delete(session.id)
        }
    }

    private activeSessionCount() {
        let count = 0
        for (const session of this.sessions.values()) {
            if (!session.exited) count += 1
        }
        return count
    }

    private async terminateForTimeout(session: SessionState) {
        if (session.exited) return
        try {
            session.proc.kill('SIGTERM')
        } catch {
            // Ignore process kill races.
        }
        await waitForExit(session, 200)
        if (!session.exited) {
            try {
                session.proc.kill('SIGKILL')
            } catch {
                // Ignore process kill races.
            }
            await waitForExit(session, 200)
        }
    }

    async start(request: StartExecRequest): Promise<string> {
        const cmd = request.cmd.trim()
        if (!cmd) {
            throw new Error('cmd must not be empty')
        }

        this.cleanupSessions()
        if (this.activeSessionCount() >= MAX_SESSIONS) {
            throw new Error(`too many active sessions (max ${MAX_SESSIONS})`)
        }

        const blocked = guardDangerousCommand({
            toolName: request.source_tool ?? 'exec_command',
            command: cmd,
        })
        if (blocked.blocked) {
            return blocked.xml
        }

        const id = this.nextId++
        const startedAtMs = Date.now()
        const shellInvocation = toShellInvocation({
            cmd,
            shell: request.shell,
            login: request.login !== false,
        })

        const runtimeCwd = getRuntimeCwd()
        const cwd = request.workdir?.trim() ? resolve(runtimeCwd, request.workdir.trim()) : runtimeCwd

        const proc = spawn(shellInvocation.file, shellInvocation.args, {
            cwd,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
        })

        const session: SessionState = {
            id,
            output: '',
            readOffset: 0,
            pendingStdinInput: '',
            startedAtMs,
            exited: false,
            exitCode: null,
            eventBus: new EventEmitter(),
            proc,
        }

        const append = (prefix: string, chunk: Buffer | string) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
            session.output += prefix ? `${prefix}${text}` : text
            session.eventBus.emit('output')
        }

        proc.stdout?.on('data', (chunk) => append('', chunk))
        proc.stderr?.on('data', (chunk) => append('', chunk))
        proc.on('error', (err) => {
            session.output += `\n[exec error] ${(err as Error).message}`
            session.eventBus.emit('output')
        })
        proc.on('close', (code) => {
            session.exited = true
            session.exitCode = typeof code === 'number' ? code : -1
            session.eventBus.emit('exit')
        })

        this.sessions.set(id, session)
        this.cleanupSessions()

        const executionTimeoutMs =
            typeof request.execution_timeout_ms === 'number' && request.execution_timeout_ms > 0
                ? Math.floor(request.execution_timeout_ms)
                : null
        const yieldMs = clampYield(request.yield_time_ms, DEFAULT_EXEC_YIELD_TIME_MS)
        const waitMs = executionTimeoutMs !== null ? Math.min(yieldMs, Math.max(0, executionTimeoutMs)) : yieldMs
        await waitForWindow(session, waitMs)

        if (executionTimeoutMs !== null && !session.exited) {
            const elapsedMs = Date.now() - startedAtMs
            if (elapsedMs >= executionTimeoutMs) {
                await this.terminateForTimeout(session)
                this.cleanupSessions()
                throw new Error(`command timed out after ${executionTimeoutMs}ms`)
            }
        }

        return this.buildResponseText(session, request.max_output_tokens)
    }

    async write(request: WriteStdinRequest): Promise<string> {
        const session = this.sessions.get(request.session_id)
        if (!session) {
            throw new Error(`session_id ${request.session_id} not found`)
        }

        if (!session.exited && request.chars && request.chars.length > 0) {
            const combinedInput = trimPendingStdinBuffer(`${session.pendingStdinInput}${request.chars}`)
            const { completedLines, remainder } = splitStdinLines(combinedInput)
            for (const line of completedLines) {
                if (!line.trim()) continue
                const blocked = guardDangerousCommand({
                    toolName: request.source_tool ?? 'write_stdin',
                    command: line,
                    sessionId: session.id,
                })
                if (blocked.blocked) {
                    session.pendingStdinInput = ''
                    return blocked.xml
                }
            }

            session.pendingStdinInput = trimPendingStdinBuffer(remainder)
            try {
                const stdin = session.proc.stdin
                if (stdin && !stdin.destroyed && !stdin.writableEnded) {
                    stdin.write(request.chars)
                }
            } catch {
                // Ignore late stdin writes on short-lived commands.
            }
        }

        const yieldMs = clampYield(request.yield_time_ms, DEFAULT_WRITE_YIELD_TIME_MS)
        await waitForWindow(session, yieldMs)

        return this.buildResponseText(session, request.max_output_tokens)
    }

    private buildResponseText(session: SessionState, maxOutputTokens?: number): string {
        const delta = session.output.slice(session.readOffset)
        const truncated = truncateByTokens(delta, maxOutputTokens)
        session.readOffset += truncated.deliveredChars

        const payload: SessionResponse = {
            sessionId: session.id,
            chunkId: formatChunkId(),
            wallTimeSeconds: (Date.now() - session.startedAtMs) / 1000,
            exitCode: session.exited ? session.exitCode : null,
            output: truncated.output,
            originalTokenCount: truncated.originalTokenCount,
        }

        return formatSessionResponse(payload)
    }
}

const singleton = new UnifiedExecManager()

export async function startExecSession(request: StartExecRequest): Promise<string> {
    return singleton.start(request)
}

export async function writeExecSession(request: WriteStdinRequest): Promise<string> {
    return singleton.write(request)
}
