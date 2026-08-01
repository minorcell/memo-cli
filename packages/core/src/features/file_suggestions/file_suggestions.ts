import { existsSync, statSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'

const DEFAULT_MAX_DEPTH = 6
const DEFAULT_MAX_ENTRIES = 2500
const DEFAULT_LIMIT = 25

const DEFAULT_IGNORE_DIRS = new Set([
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
])

export type FileSuggestion = {
    id: string
    path: string
    name: string
    parent?: string
    isDir: boolean
}

export type FileSuggestionRequest = {
    cwd: string
    query: string
    limit?: number
    maxDepth?: number
    maxEntries?: number
    respectGitIgnore?: boolean
    ignoreGlobs?: string[]
}

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

type GitIgnoreMatcher = {
    root: string
    ignores: (absPath: string) => boolean
}

const directoryCache = new Map<string, DirectoryCache>()
const gitIgnoreMatcherCache = new Map<string, Promise<GitIgnoreMatcher>>()
const ignoreRootCache = new Map<string, string>()
const MAX_IGNORE_ROOT_CACHE = 256

function rememberIgnoreRoot(path: string, root: string): void {
    if (ignoreRootCache.size >= MAX_IGNORE_ROOT_CACHE && !ignoreRootCache.has(path)) {
        const oldest = ignoreRootCache.keys().next().value
        if (typeof oldest === 'string') {
            ignoreRootCache.delete(oldest)
        }
    }
    ignoreRootCache.set(path, root)
}

export function normalizePath(input: string): string {
    return input.split(sep).join('/')
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
        maxEntries: typeof req.maxEntries === 'number' ? Math.max(100, req.maxEntries) : DEFAULT_MAX_ENTRIES,
        limit: typeof req.limit === 'number' ? Math.max(1, req.limit) : DEFAULT_LIMIT,
        respectGitIgnore: req.respectGitIgnore ?? true,
        ignoreGlobs: req.ignoreGlobs?.length ? req.ignoreGlobs : [],
    }
}

function shouldIgnorePath(normalizedPath: string, req: NormalizedOptions): boolean {
    const segments = normalizedPath.split('/').filter(Boolean)
    const fileName = segments[segments.length - 1] ?? ''

    if (segments.some((segment) => DEFAULT_IGNORE_DIRS.has(segment))) {
        return true
    }

    if (fileName.endsWith('.log')) {
        return true
    }

    if (!req.ignoreGlobs.length) {
        return false
    }

    return req.ignoreGlobs.some((pattern) => {
        const normalizedPattern = pattern.replace(/\\/g, '/').trim()
        if (!normalizedPattern) return false
        if (normalizedPattern.endsWith('/**')) {
            const prefix = normalizedPattern.slice(0, -3)
            return normalizedPath.startsWith(prefix)
        }
        if (normalizedPattern.startsWith('*')) {
            const suffix = normalizedPattern.slice(1)
            return normalizedPath.endsWith(suffix)
        }
        return normalizedPath.includes(normalizedPattern)
    })
}

function toPosixPath(inputPath: string): string {
    return inputPath.replace(/\\/g, '/')
}

function findIgnoreRoot(startPath: string): string {
    const resolvedStart = resolve(startPath)
    const cached = ignoreRootCache.get(resolvedStart)
    if (cached) return cached

    let dir = resolvedStart
    try {
        if (statSync(dir).isFile()) {
            dir = dirname(dir)
        }
    } catch {
        dir = process.cwd()
    }
    const initial = dir
    const visited: string[] = []

    while (true) {
        visited.push(dir)
        if (existsSync(join(dir, '.gitignore')) || existsSync(join(dir, '.git'))) {
            for (const item of visited) {
                rememberIgnoreRoot(item, dir)
            }
            rememberIgnoreRoot(resolvedStart, dir)
            return dir
        }
        const parent = dirname(dir)
        if (parent === dir) {
            for (const item of visited) {
                rememberIgnoreRoot(item, initial)
            }
            rememberIgnoreRoot(resolvedStart, initial)
            return initial
        }
        dir = parent
    }
}

async function loadGitignore(root: string): Promise<string[]> {
    const gitignorePath = join(root, '.gitignore')
    try {
        const raw = await readFile(gitignorePath, 'utf8')
        return raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith('#'))
    } catch {
        return []
    }
}

function createIgMatcher(rules: string[]): Ignore {
    const ig = ignore()
    if (rules.length > 0) {
        ig.add(rules)
    }
    return ig
}

async function buildGitIgnoreMatcher(root: string): Promise<GitIgnoreMatcher> {
    const ig = createIgMatcher(await loadGitignore(root))
    return {
        root,
        ignores: (absPath: string) => {
            const rel = relative(root, absPath)
            if (!rel || rel.startsWith('..')) return false
            return ig.ignores(toPosixPath(rel))
        },
    }
}

async function getGitIgnoreMatcher(startPath: string): Promise<GitIgnoreMatcher> {
    const root = findIgnoreRoot(startPath)
    const cached = gitIgnoreMatcherCache.get(root)
    if (cached) return cached

    const pending = buildGitIgnoreMatcher(root).catch((err) => {
        gitIgnoreMatcherCache.delete(root)
        throw err
    })

    gitIgnoreMatcherCache.set(root, pending)
    return pending
}

function buildSignature(opts: NormalizedOptions): string {
    return JSON.stringify({
        maxDepth: opts.maxDepth,
        maxEntries: opts.maxEntries,
        respectGitIgnore: opts.respectGitIgnore,
        ignoreGlobs: opts.ignoreGlobs,
    })
}

async function scanDirectory(cwd: string, opts: NormalizedOptions): Promise<IndexedEntry[]> {
    const entries: IndexedEntry[] = []
    const gitIgnoreMatcher = opts.respectGitIgnore ? await getGitIgnoreMatcher(cwd) : null

    const walk = async (dir: string, depth: number) => {
        if (entries.length >= opts.maxEntries) return

        let dirents
        try {
            dirents = await readdir(dir, { withFileTypes: true })
        } catch {
            return
        }

        for (const dirent of dirents) {
            if (entries.length >= opts.maxEntries) break
            if (dirent.isSymbolicLink()) continue

            const absolute = join(dir, dirent.name)
            if (gitIgnoreMatcher?.ignores(absolute)) {
                continue
            }

            const rel = relative(cwd, absolute)
            if (!rel) continue

            const normalized = normalizePath(rel)
            if (shouldIgnorePath(normalized, opts)) {
                continue
            }

            const segments = normalized.split('/').filter(Boolean)
            const isDir = dirent.isDirectory()
            entries.push({
                path: normalized,
                pathLower: normalized.toLowerCase(),
                segments,
                segmentsLower: segments.map((segment) => segment.toLowerCase()),
                depth,
                isDir,
            })

            if (isDir && depth < opts.maxDepth) {
                await walk(absolute, depth + 1)
            }
        }
    }

    await walk(cwd, 0)
    entries.sort((a, b) => a.path.localeCompare(b.path))
    return entries
}

async function ensureEntries(cwd: string, req: FileSuggestionRequest): Promise<IndexedEntry[]> {
    const options = normalizeOptions(req)
    const signature = buildSignature(options)
    const cached = directoryCache.get(cwd)

    if (cached && cached.signature === signature) {
        if (cached.pending) return cached.pending
        return cached.entries
    }

    const pending = scanDirectory(cwd, options)
        .then((entries) => {
            directoryCache.set(cwd, {
                entries,
                signature,
            })
            return entries
        })
        .catch((err) => {
            directoryCache.delete(cwd)
            throw err
        })

    directoryCache.set(cwd, {
        entries: [],
        signature,
        pending,
    })

    return pending
}

type RankedEntry = {
    entry: IndexedEntry
    score: number
}

function matchTokens(entry: IndexedEntry, tokens: string[]): number | null {
    if (!tokens.length) {
        return entry.depth + (entry.isDir ? -0.2 : 0.2)
    }

    let score = entry.depth
    let cursor = 0

    for (const token of tokens) {
        let found = -1

        for (let i = cursor; i < entry.segmentsLower.length; i++) {
            const segment = entry.segmentsLower[i] as string
            if (segment.startsWith(token)) {
                found = i
                score += (i - cursor) * 1.2
                score += segment.length - token.length
                break
            }

            const pos = segment.indexOf(token)
            if (pos !== -1) {
                found = i
                score += (i - cursor) * 2 + pos + 2
                break
            }
        }

        if (found === -1) return null
        cursor = found + 1
    }

    if (entry.isDir) score -= 0.5
    return score
}

function rankEntries(entries: IndexedEntry[], query: string, limit: number): FileSuggestion[] {
    const normalized = query.trim().replace(/\\/g, '/')
    const tokens = normalized
        .split('/')
        .filter(Boolean)
        .map((token) => token.toLowerCase())

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
        parent: entry.segments.length > 1 ? entry.segments.slice(0, -1).join('/') : undefined,
        isDir: entry.isDir,
    }))
}

export async function getFileSuggestions(req: FileSuggestionRequest): Promise<FileSuggestion[]> {
    const entries = await ensureEntries(req.cwd, req)
    const limit = typeof req.limit === 'number' ? Math.max(1, req.limit) : DEFAULT_LIMIT
    return rankEntries(entries, req.query, limit)
}

export function invalidateFileSuggestionCache(cwd?: string): void {
    if (cwd) {
        directoryCache.delete(cwd)
        const root = findIgnoreRoot(cwd)
        gitIgnoreMatcherCache.delete(root)
        const resolvedCwd = resolve(cwd)
        for (const [path, cachedRoot] of ignoreRootCache.entries()) {
            if (path === resolvedCwd || cachedRoot === root) {
                ignoreRootCache.delete(path)
            }
        }
        return
    }
    directoryCache.clear()
    gitIgnoreMatcherCache.clear()
    ignoreRootCache.clear()
}
