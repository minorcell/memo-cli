import { HistoryIndex, type SessionListItem } from '@memo/core'
import { basename, resolve } from 'node:path'

export type SessionHistoryEntry = {
    id: string
    cwd: string
    input: string
    ts: number
    sessionFile: string
}

const historyIndexCache = new Map<string, HistoryIndex>()

function normalizeCwd(input: string): string {
    const normalized = resolve(input)
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function sessionFileId(filePath: string): string {
    return resolve(filePath)
}

function getHistoryIndex(sessionsDir: string): HistoryIndex {
    const normalizedDir = resolve(sessionsDir)
    const existing = historyIndexCache.get(normalizedDir)
    if (existing) return existing

    const index = new HistoryIndex({ sessionsDir: normalizedDir })
    historyIndexCache.set(normalizedDir, index)
    return index
}

function parseTimestamp(value: string): number {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function resolveEntryTitle(summary: SessionListItem): string {
    const title = summary.title?.trim()
    if (title) return title
    return basename(summary.filePath).replace(/\.jsonl$/i, '')
}

export async function loadSessionHistoryEntries(options: {
    sessionsDir: string
    cwd: string
    keyword?: string
    activeSessionFile?: string
    limit?: number
}): Promise<SessionHistoryEntry[]> {
    const limit = options.limit ?? 10
    if (limit <= 0) return []

    const index = getHistoryIndex(options.sessionsDir)
    const summaries = await index.getAllSummaries()
    const normalizedCwd = normalizeCwd(options.cwd)
    const normalizedActive = options.activeSessionFile ? sessionFileId(options.activeSessionFile) : null
    const keyword = options.keyword?.trim().toLowerCase()

    const seen = new Set<string>()
    const entries: SessionHistoryEntry[] = []

    const sorted = [...summaries].sort((left, right) => right.date.updatedAt.localeCompare(left.date.updatedAt))

    for (const summary of sorted) {
        if (entries.length >= limit) break
        if (normalizeCwd(summary.cwd) !== normalizedCwd) continue

        const sessionFile = sessionFileId(summary.filePath)
        if (normalizedActive && sessionFile === normalizedActive) continue
        if (seen.has(sessionFile)) continue

        const input = resolveEntryTitle(summary)
        if (keyword && !input.toLowerCase().includes(keyword)) continue

        seen.add(sessionFile)
        entries.push({
            id: sessionFile,
            cwd: options.cwd,
            input,
            ts: parseTimestamp(summary.date.updatedAt),
            sessionFile,
        })
    }

    return entries
}
