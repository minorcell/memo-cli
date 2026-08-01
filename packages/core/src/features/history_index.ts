import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
    SessionDetail,
    SessionEventItem,
    SessionEventsResponse,
    SessionListItem,
    SessionListResponse,
    ToolUsageSummary,
} from '../api_types.js'
import { parseHistoryLogToSessionDetail } from './history_parser.js'
import { cwdBelongsToWorkspace } from '../utils/workspace.js'

type SessionFileMeta = {
    filePath: string
    mtimeMs: number
    size: number
}

type HistoryIndexEntry = {
    filePath: string
    mtimeMs: number
    size: number
    summary: SessionListItem
    detail: SessionDetail
}

export type HistoryIndexListQuery = {
    page?: number
    pageSize?: number
    sortBy?: 'updatedAt' | 'startedAt' | 'project' | 'title'
    order?: 'asc' | 'desc'
    project?: string
    workspaceCwd?: string
    dateFrom?: string
    dateTo?: string
    q?: string
}

function normalizePage(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    const parsed = Math.floor(value)
    return parsed > 0 ? parsed : fallback
}

function normalizePageSize(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    const parsed = Math.floor(value)
    if (parsed <= 0) return fallback
    return Math.min(parsed, 100)
}

function normalizeDateOnly(value: string | undefined): string | null {
    if (!value) return null
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    return null
}

async function walkSessionFiles(sessionsDir: string): Promise<SessionFileMeta[]> {
    const files: SessionFileMeta[] = []

    const walk = async (dirPath: string): Promise<void> => {
        let entries: import('node:fs').Dirent[]
        try {
            entries = await readdir(dirPath, { withFileTypes: true })
        } catch {
            return
        }

        await Promise.all(
            entries.map(async (entry) => {
                if (entry.isSymbolicLink()) return
                const fullPath = join(dirPath, entry.name)
                if (entry.isDirectory()) {
                    await walk(fullPath)
                    return
                }
                if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return

                try {
                    const meta = await stat(fullPath)
                    files.push({
                        filePath: resolve(fullPath),
                        mtimeMs: meta.mtimeMs,
                        size: meta.size,
                    })
                } catch {
                    // Ignore transient file errors.
                }
            }),
        )
    }

    await walk(resolve(sessionsDir))
    return files
}

function compareSummaries(
    a: SessionListItem,
    b: SessionListItem,
    sortBy: NonNullable<HistoryIndexListQuery['sortBy']>,
    order: NonNullable<HistoryIndexListQuery['order']>,
): number {
    const direction = order === 'asc' ? 1 : -1

    if (sortBy === 'project') {
        const result = a.project.localeCompare(b.project)
        return result === 0 ? a.date.updatedAt.localeCompare(b.date.updatedAt) * direction : result * direction
    }

    if (sortBy === 'title') {
        const result = a.title.localeCompare(b.title)
        return result === 0 ? a.date.updatedAt.localeCompare(b.date.updatedAt) * direction : result * direction
    }

    if (sortBy === 'startedAt') {
        return a.date.startedAt.localeCompare(b.date.startedAt) * direction
    }

    return a.date.updatedAt.localeCompare(b.date.updatedAt) * direction
}

function filterSummary(summary: SessionListItem, query: HistoryIndexListQuery): boolean {
    const projectName = summary.project.trim()
    const cwd = summary.cwd.trim()
    const looksLikeFallbackName =
        /^\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}(?:\.\d+)?(?:Z)?-[A-Za-z0-9._-]+$/i.test(projectName) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectName) ||
        projectName === summary.sessionId

    if (!projectName || !cwd || looksLikeFallbackName) {
        return false
    }

    if (query.workspaceCwd && !cwdBelongsToWorkspace(cwd, query.workspaceCwd)) {
        return false
    }

    if (query.project) {
        const expected = query.project.trim().toLowerCase()
        if (expected && projectName.toLowerCase() !== expected) return false
    }

    const from = normalizeDateOnly(query.dateFrom)
    const to = normalizeDateOnly(query.dateTo)
    if (from && summary.date.day < from) return false
    if (to && summary.date.day > to) return false

    const rawQ = query.q?.trim().toLowerCase()
    if (rawQ) {
        const haystack = [summary.title, projectName, cwd, summary.sessionId, summary.filePath].join('\n').toLowerCase()
        if (!haystack.includes(rawQ)) return false
    }

    return true
}

export class HistoryIndex {
    private readonly sessionsDir: string
    private readonly cache = new Map<string, HistoryIndexEntry>()
    private readonly sessionIdToPath = new Map<string, string>()
    private refreshInFlight: Promise<void> | null = null

    constructor(options: { sessionsDir: string }) {
        this.sessionsDir = resolve(options.sessionsDir)
    }

    async refresh(): Promise<void> {
        if (this.refreshInFlight) {
            await this.refreshInFlight
            return
        }

        const task = this.refreshInternal()
        this.refreshInFlight = task
        try {
            await task
        } finally {
            this.refreshInFlight = null
        }
    }

    async list(query: HistoryIndexListQuery = {}): Promise<SessionListResponse> {
        await this.refresh()

        const page = normalizePage(query.page, 1)
        const pageSize = normalizePageSize(query.pageSize, 20)
        const sortBy = query.sortBy ?? 'updatedAt'
        const order = query.order ?? 'desc'

        const filtered = Array.from(this.cache.values())
            .map((entry) => entry.summary)
            .filter((summary) => filterSummary(summary, query))
            .sort((a, b) => compareSummaries(a, b, sortBy, order))

        const total = filtered.length
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)
        const start = (page - 1) * pageSize
        const items = filtered.slice(start, start + pageSize)

        return {
            items,
            page,
            pageSize,
            total,
            totalPages,
        }
    }

    async getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
        await this.refresh()
        const path = this.sessionIdToPath.get(sessionId)
        if (!path) return null
        return this.cache.get(path)?.detail ?? null
    }

    async getSessionEvents(
        sessionId: string,
        cursor: string | undefined,
        limit: number | undefined,
    ): Promise<SessionEventsResponse | null> {
        const detail = await this.getSessionDetail(sessionId)
        if (!detail) return null

        const offset = Number.parseInt(cursor ?? '0', 10)
        const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0
        const pageSize = normalizePageSize(limit, 100)
        const items = detail.events.slice(safeOffset, safeOffset + pageSize)
        const nextOffset = safeOffset + items.length

        return {
            items,
            nextCursor: nextOffset >= detail.events.length ? null : String(nextOffset),
        }
    }

    async getAllSummaries(): Promise<SessionListItem[]> {
        await this.refresh()
        return Array.from(this.cache.values()).map((entry) => entry.summary)
    }

    private async refreshInternal(): Promise<void> {
        const files = await walkSessionFiles(this.sessionsDir)
        const knownPaths = new Set(files.map((file) => file.filePath))

        for (const existingPath of Array.from(this.cache.keys())) {
            if (!knownPaths.has(existingPath)) {
                const existing = this.cache.get(existingPath)
                if (existing) {
                    this.sessionIdToPath.delete(existing.summary.sessionId)
                }
                this.cache.delete(existingPath)
            }
        }

        for (const file of files) {
            const existing = this.cache.get(file.filePath)
            if (existing && existing.mtimeMs === file.mtimeMs && existing.size === file.size) {
                continue
            }

            try {
                const raw = await readFile(file.filePath, 'utf8')
                const detail = parseHistoryLogToSessionDetail(raw, file.filePath)
                const summary = detail as SessionListItem
                const entry: HistoryIndexEntry = {
                    filePath: file.filePath,
                    mtimeMs: file.mtimeMs,
                    size: file.size,
                    summary,
                    detail,
                }

                if (existing) {
                    this.sessionIdToPath.delete(existing.summary.sessionId)
                }
                this.cache.set(file.filePath, entry)
                this.sessionIdToPath.set(summary.sessionId, file.filePath)
            } catch {
                // Ignore malformed files; keep refresh resilient.
            }
        }
    }
}

export function aggregateToolUsage(events: SessionEventItem[]): Record<string, ToolUsageSummary> {
    const usageByTool: Record<string, ToolUsageSummary> = {}

    const getBucket = (tool: string): ToolUsageSummary => {
        if (!usageByTool[tool]) {
            usageByTool[tool] = {
                total: 0,
                success: 0,
                failed: 0,
                denied: 0,
                cancelled: 0,
            }
        }
        return usageByTool[tool]
    }

    for (const event of events) {
        if (event.type === 'action') {
            const tool =
                typeof event.meta?.tool === 'string'
                    ? event.meta.tool
                    : Array.isArray(event.meta?.tools)
                      ? String(event.meta.tools[0] ?? '')
                      : ''
            if (!tool) continue
            getBucket(tool).total += 1
        }

        if (event.type === 'observation') {
            const tool = typeof event.meta?.tool === 'string' ? event.meta.tool : ''
            if (!tool) continue
            const bucket = getBucket(tool)
            const status = typeof event.meta?.status === 'string' ? event.meta.status.toLowerCase() : ''
            if (status === 'success') {
                bucket.success += 1
            } else if (status === 'approval_denied') {
                bucket.denied += 1
                bucket.failed += 1
            } else if (status === 'cancelled') {
                bucket.cancelled += 1
            } else {
                bucket.failed += 1
            }
        }
    }

    return usageByTool
}
