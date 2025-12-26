/** @file CLI 输入历史持久化：按工作目录分桶，并暴露查询接口。 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
    InputHistoryEntry,
    InputHistoryQuery,
    InputHistoryStoreOptions,
} from './types'

const DEFAULT_MAX_ENTRIES = 500

export class InputHistoryStore {
    private entries: InputHistoryEntry[] = []
    private loaded = false
    private pendingWrite: Promise<void> | null = null

    constructor(private options: InputHistoryStoreOptions) {}

    private async ensureLoaded() {
        if (this.loaded) return
        try {
            const raw = await readFile(this.options.filePath, 'utf8')
            const parsed = JSON.parse(raw) as InputHistoryEntry[]
            if (Array.isArray(parsed)) {
                this.entries = parsed
            }
        } catch {
            this.entries = []
        } finally {
            this.loaded = true
        }
    }

    private trimToLimit() {
        const maxEntries = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES
        if (this.entries.length > maxEntries) {
            this.entries = this.entries.slice(this.entries.length - maxEntries)
        }
    }

    private enqueueWrite() {
        const writeTask = async () => {
            await mkdir(dirname(this.options.filePath), { recursive: true })
            await writeFile(this.options.filePath, JSON.stringify(this.entries, null, 2), 'utf8')
        }
        if (this.pendingWrite) {
            this.pendingWrite = this.pendingWrite.then(() => writeTask())
        } else {
            this.pendingWrite = writeTask()
        }
        const current = this.pendingWrite
        current
            .catch(() => {
                // swallow write errors，读取时再恢复
            })
            .finally(() => {
                if (this.pendingWrite === current) {
                    this.pendingWrite = null
                }
            })
        return current
    }

    /** 记录新的历史输入，按 cwd 聚合，避免重复堆积。 */
    async record(entry: { cwd: string; input: string; sessionFile?: string }) {
        const trimmed = entry.input.trim()
        if (!trimmed) return
        await this.ensureLoaded()
        const now = Date.now()
        this.entries = this.entries.filter(
            (item) => !(item.cwd === entry.cwd && item.input === trimmed),
        )
        const newEntry: InputHistoryEntry = {
            id: randomUUID(),
            cwd: entry.cwd,
            input: trimmed,
            ts: now,
            sessionFile: entry.sessionFile,
        }
        this.entries.push(newEntry)
        this.trimToLimit()
        await this.enqueueWrite().catch(() => {
            // ignore fs errors
        })
    }

    /** 查询当前工作目录下的历史记录，按时间逆序排序并支持关键字过滤。 */
    async query(query: InputHistoryQuery): Promise<InputHistoryEntry[]> {
        await this.ensureLoaded()
        const keyword = query.keyword?.trim().toLowerCase()
        const limit = query.limit ?? 20
        const exactMatches = this.entries
            .filter((entry) => entry.cwd === query.cwd)
            .sort((a, b) => b.ts - a.ts)

        let filtered = keyword
            ? exactMatches.filter((entry) => entry.input.toLowerCase().includes(keyword))
            : exactMatches

        if (typeof query.beforeTs === 'number') {
            const beforeTs = query.beforeTs
            filtered = filtered.filter((entry) => entry.ts <= beforeTs)
        }

        return filtered.slice(0, limit)
    }
}
