/** @file 工作目录文件建议：递归扫描并根据输入前缀/片段排序。 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import type { FileSuggestion, FileSuggestionRequest } from './types'

const DEFAULT_MAX_DEPTH = 6
const DEFAULT_MAX_ENTRIES = 2500
const DEFAULT_LIMIT = 25
const DEFAULT_IGNORE = [
    '.git',
    '.svn',
    '.hg',
    'node_modules',
    'dist',
    'build',
    '.next',
    '.turbo',
    '.cache',
    '.output',
    'coverage',
    'tmp',
    'temp',
    'logs',
    '*.log',
]

type IndexedEntry = {
    path: string
    pathLower: string
    segments: string[]
    segmentsLower: string[]
    depth: number
    isDir: boolean
}

type DirectoryCache = {
    entries: IndexedEntry[]
    signature: string
    pending?: Promise<IndexedEntry[]>
}

const directoryCache = new Map<string, DirectoryCache>()

export function normalizePath(input: string) {
    return input.split(sep).join('/')
}

function buildSignature(opts: NormalizedOptions, gitignoreContent: string) {
    return JSON.stringify({
        maxDepth: opts.maxDepth,
        maxEntries: opts.maxEntries,
        respectGitIgnore: opts.respectGitIgnore,
        ignoreGlobs: opts.ignoreGlobs,
        gitignore: gitignoreContent,
    })
}

type NormalizedOptions = {
    maxDepth: number
    maxEntries: number
    limit: number
    respectGitIgnore: boolean
    ignoreGlobs: string[]
}

function normalizeOptions(req: FileSuggestionRequest): NormalizedOptions {
    return {
        maxDepth: typeof req.maxDepth === 'number' ? Math.max(1, req.maxDepth) : DEFAULT_MAX_DEPTH,
        maxEntries:
            typeof req.maxEntries === 'number' ? Math.max(100, req.maxEntries) : DEFAULT_MAX_ENTRIES,
        limit: typeof req.limit === 'number' ? Math.max(1, req.limit) : DEFAULT_LIMIT,
        respectGitIgnore: req.respectGitIgnore !== false,
        ignoreGlobs: req.ignoreGlobs?.length ? req.ignoreGlobs : [],
    }
}

async function readGitIgnore(cwd: string, respectGitIgnore: boolean): Promise<string> {
    if (!respectGitIgnore) return ''
    try {
        return await readFile(join(cwd, '.gitignore'), 'utf8')
    } catch {
        // ignore read failure
    }
    return ''
}

type IgnoreMatcher = Ignore & { __memoSignature: string }

async function createIgnoreMatcher(opts: NormalizedOptions, cwd: string): Promise<IgnoreMatcher> {
    const content = await readGitIgnore(cwd, opts.respectGitIgnore)
    const ig = ignore()
    ig.add(DEFAULT_IGNORE)
    if (opts.ignoreGlobs.length) {
        ig.add(opts.ignoreGlobs)
    }
    if (content.trim()) {
        ig.add(content)
    }
    const signature = buildSignature(opts, content)
    return Object.assign(ig, { __memoSignature: signature }) as IgnoreMatcher
}

async function scanDirectory(
    cwd: string,
    opts: NormalizedOptions,
    matcher: IgnoreMatcher,
): Promise<{ entries: IndexedEntry[]; signature: string }> {
    const entries: IndexedEntry[] = []
    const maxEntries = opts.maxEntries

    const walk = async (dir: string, depth: number) => {
        if (entries.length >= maxEntries) return
        let dirents
        try {
            dirents = await readdir(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const dirent of dirents) {
            if (entries.length >= maxEntries) break
            if (dirent.isSymbolicLink()) continue
            const abs = join(dir, dirent.name)
            const rel = relative(cwd, abs)
            if (!rel) continue
            const normalized = normalizePath(rel)
            if (matcher.ignores(normalized)) continue
            const segments = normalized.split('/').filter(Boolean)
            const segmentsLower = segments.map((s) => s.toLowerCase())
            const isDir = dirent.isDirectory()
            entries.push({
                path: normalized,
                pathLower: normalized.toLowerCase(),
                segments,
                segmentsLower,
                depth,
                isDir,
            })
            if (entries.length >= maxEntries) break
            if (isDir && depth < opts.maxDepth) {
                await walk(abs, depth + 1)
            }
        }
    }

    await walk(cwd, 0)
    entries.sort((a, b) => a.path.localeCompare(b.path))
    return { entries, signature: matcher.__memoSignature }
}

async function ensureEntries(cwd: string, req: FileSuggestionRequest) {
    const opts = normalizeOptions(req)
    const ig = await createIgnoreMatcher(opts, cwd)
    const signature = ig.__memoSignature
    const cached = directoryCache.get(cwd)
    if (cached && cached.signature === signature) {
        if (cached.pending) {
            return cached.pending
        }
        return cached.entries
    }
    const buildPromise = scanDirectory(cwd, opts, ig)
        .then((result) => {
            directoryCache.set(cwd, { entries: result.entries, signature: result.signature })
            return result.entries
        })
        .catch((err) => {
            directoryCache.delete(cwd)
            throw err
        })
    directoryCache.set(cwd, { entries: [], signature, pending: buildPromise })
    return buildPromise
}

type RankedEntry = { entry: IndexedEntry; score: number }

function baseScore(entry: IndexedEntry) {
    return entry.depth + (entry.isDir ? -0.2 : 0.2)
}

function matchTokens(entry: IndexedEntry, tokens: string[]) {
    if (!tokens.length) return baseScore(entry)
    let score = entry.depth
    let cursor = 0
    for (const token of tokens) {
        let foundIndex = -1
        for (let idx = cursor; idx < entry.segmentsLower.length; idx++) {
            const segment = entry.segmentsLower[idx] as string
            if (segment.startsWith(token)) {
                foundIndex = idx
                score += (idx - cursor) * 1.5
                score += segment.length - token.length
                break
            }
            const pos = segment.indexOf(token)
            if (pos !== -1) {
                foundIndex = idx
                score += (idx - cursor) * 2 + pos + 2
                break
            }
        }
        if (foundIndex === -1) return null
        cursor = foundIndex + 1
    }
    if (entry.isDir) score -= 0.5
    return score
}

function rankEntries(entries: IndexedEntry[], query: string, limit: number): FileSuggestion[] {
    const normalized = query.trim().replace(/\\/g, '/')
    const rawTokens = normalized.split('/').filter(Boolean)
    const tokens = rawTokens.map((token) => token.toLowerCase())
    const ranked: RankedEntry[] = []

    for (const entry of entries) {
        const score = matchTokens(entry, tokens)
        if (score === null) continue
        ranked.push({ entry, score })
    }

    ranked.sort((a, b) => {
        const diff = a.score - b.score
        if (diff !== 0) return diff
        return a.entry.path.localeCompare(b.entry.path)
    })

    return ranked.slice(0, limit).map(({ entry }) => ({
        id: entry.path,
        path: entry.path,
        name: entry.segments[entry.segments.length - 1] ?? entry.path,
        parent:
            entry.segments.length > 1 ? entry.segments.slice(0, -1).join('/') : undefined,
        isDir: entry.isDir,
    }))
}

/** 获取匹配文件/目录的建议列表，结果按匹配度排序。 */
export async function getFileSuggestions(
    req: FileSuggestionRequest,
): Promise<FileSuggestion[]> {
    const entries = await ensureEntries(req.cwd, req)
    const limit = typeof req.limit === 'number' ? Math.max(1, req.limit) : DEFAULT_LIMIT
    return rankEntries(entries, req.query, limit)
}

/** 主动清空某个目录的缓存（例如目录切换）。 */
export function invalidateFileSuggestionCache(cwd?: string) {
    if (cwd) {
        directoryCache.delete(cwd)
        return
    }
    directoryCache.clear()
}
