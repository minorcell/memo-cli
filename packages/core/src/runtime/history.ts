import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { HistoryEvent, HistorySink, Role } from "@memo/core/types"

/** JSONL 历史写入器：一行一个事件。 */
export class JsonlHistorySink implements HistorySink {
    private ready = false

    constructor(private filePath: string) {}

    async append(event: HistoryEvent) {
        if (!this.ready) {
            await mkdir(dirname(this.filePath), { recursive: true })
            this.ready = true
        }
        await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8")
    }

    async flush() {
        // appendFile 已确保落盘，这里仅保留接口兼容
        return Promise.resolve()
    }
}

/** 辅助生成结构化历史事件。 */
export function createHistoryEvent(params: {
    sessionId: string
    type: HistoryEvent["type"]
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
