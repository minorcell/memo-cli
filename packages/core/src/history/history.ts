/** @file History event definition and JSONL Sink implementation. */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { HistoryEvent, HistorySink, Role } from '@memo/core/types'

/** JSONL history writer: one event per line. */
export class JsonlHistorySink implements HistorySink {
    private ensureDirPromise: Promise<void> | null = null
    private writeQueue: Promise<void> = Promise.resolve()
    private closed = false

    constructor(private filePath: string) {}

    private ensureDirectory() {
        if (!this.ensureDirPromise) {
            this.ensureDirPromise = mkdir(dirname(this.filePath), { recursive: true }).then(() => {})
        }
        return this.ensureDirPromise
    }

    async append(event: HistoryEvent) {
        if (this.closed) {
            throw new Error('History sink is closed')
        }
        this.writeQueue = this.writeQueue.then(async () => {
            await this.ensureDirectory()
            await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8')
        })
        return this.writeQueue
    }

    async flush() {
        await this.writeQueue
    }

    async close() {
        if (this.closed) return
        this.closed = true
        await this.flush()
    }
}

/** Helper to generate structured history events. */
export function createHistoryEvent(params: {
    sessionId: string
    type: HistoryEvent['type']
    turn?: number
    step?: number
    content?: string
    role?: Role
    meta?: Record<string, unknown>
}): HistoryEvent {
    return {
        ts: new Date().toISOString(),
        sessionId: params.sessionId,
        turn: params.turn,
        step: params.step,
        type: params.type,
        content: params.content,
        role: params.role,
        meta: params.meta,
    }
}
