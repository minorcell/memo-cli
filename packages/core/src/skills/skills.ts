import { access, readFile, readdir, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import fg from 'fast-glob'

export type SkillScope = 'project' | 'global'

export type SkillMetadata = {
    name: string
    description: string
    /** Winning path (first by root priority) for the deduped skill. */
    path: string
    /** All absolute SKILL.md paths with identical content, winner first. */
    paths: string[]
    /** sha256 of the SKILL.md content; dedup key. */
    hash: string
    scope: SkillScope
    /** Root directory the skill was discovered from. */
    sourceRoot: string
}

/** Index over a deduped skill snapshot, used by read_skill and the CLI. */
export type SkillIndex = {
    list: SkillMetadata[]
    /** name → all records (same name with different content coexists). */
    byName: Map<string, SkillMetadata[]>
    /** resolved absolute path → record (includes deduped-away copies). */
    byPath: Map<string, SkillMetadata>
    byHash: Map<string, SkillMetadata>
}

type LoadSkillsOptions = {
    cwd?: string
    homeDir?: string
    memoHome?: string
    skillRoots?: string[]
    maxSkills?: number
}

const SKILL_FILENAME = 'SKILL.md'
const MAX_SCAN_DEPTH = 6
const DEFAULT_MAX_SKILLS = 200
const MAX_NAME_LEN = 64
const MAX_DESCRIPTION_LEN = 1024

/** Context budget for the skills directory in the system prompt (fixed fallback). */
export const DEFAULT_SKILLS_BUDGET_CHARS = 4096

/** Smallest entry worth keeping in the skills directory: "- a: b" shape. */
const MIN_ENTRY_CHARS = 8

const SKILLS_USAGE_RULES = `- Discovery: The list above is the skills available in this session (name + description). To use a skill, call the \`read_skill\` tool with its name (or its SKILL.md path when names are ambiguous) to load the full SKILL.md instructions.
- Trigger rules: If the user names a skill (with \`$SkillName\` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or the read_skill call fails, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, call \`read_skill\` with the skill name. Read only enough to follow the workflow.
  2) When \`SKILL.md\` references relative paths (e.g., \`scripts/foo.py\`), resolve them relative to the skill directory returned by \`read_skill\` first, and only consider other paths if needed.
  3) If \`SKILL.md\` points to extra folders such as \`references/\`, load only the specific files needed for the request; don't bulk-load everything.
  4) If \`scripts/\` exist, prefer running or patching them instead of retyping large code blocks.
  5) If \`assets/\` or templates exist, reuse them instead of recreating from scratch.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.
  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.
- Context hygiene:
  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deep reference-chasing: prefer opening only files directly linked from \`SKILL.md\` unless you're blocked.
  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.
- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.`

function normalizeValue(raw: string): string {
    return raw.trim().split(/\s+/).join(' ')
}

function unquote(raw: string): string {
    const trimmed = raw.trim()
    if (trimmed.length >= 2) {
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            return trimmed.slice(1, -1)
        }
        if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
            return trimmed.slice(1, -1)
        }
    }
    return trimmed
}

function extractFrontmatter(content: string): string | null {
    const lines = content.split(/\r?\n/)
    if (lines[0]?.trim() !== '---') {
        return null
    }

    const frontmatterLines: string[] = []
    let foundClosing = false
    for (const line of lines.slice(1)) {
        if (line.trim() === '---') {
            foundClosing = true
            break
        }
        frontmatterLines.push(line)
    }

    if (!foundClosing || frontmatterLines.length === 0) {
        return null
    }

    return frontmatterLines.join('\n')
}

function parseMultilineValue(frontmatter: string, key: string): string | null {
    const lines = frontmatter.split(/\r?\n/)
    let inBlock = false
    const collected: string[] = []
    for (const line of lines) {
        if (!inBlock) {
            // YAML block scalars: "key: >", "key: >-", "key: |", "key: |-".
            const match = line.match(new RegExp(`^${key}\\s*:\\s*[|>]-?\\s*$`))
            if (match) {
                inBlock = true
            }
            continue
        }

        if (!/^\s+/.test(line)) {
            break
        }
        collected.push(line.replace(/^\s+/, ''))
    }

    if (collected.length === 0) {
        return null
    }
    return normalizeValue(collected.join(' '))
}

function parseFrontmatterValue(frontmatter: string, key: string): string | null {
    const multiline = parseMultilineValue(frontmatter, key)
    if (multiline) {
        return multiline
    }

    const pattern = new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, 'm')
    const match = frontmatter.match(pattern)
    if (!match?.[1]) {
        return null
    }
    return normalizeValue(unquote(match[1]))
}

type ParsedSkillFile = Pick<SkillMetadata, 'name' | 'description' | 'path'>

function parseSkillFile(content: string, path: string): ParsedSkillFile | null {
    const frontmatter = extractFrontmatter(content)
    if (!frontmatter) {
        return null
    }

    const name = parseFrontmatterValue(frontmatter, 'name')
    const description = parseFrontmatterValue(frontmatter, 'description')
    if (!name || !description) {
        return null
    }

    if (name.length > MAX_NAME_LEN || description.length > MAX_DESCRIPTION_LEN) {
        return null
    }

    return {
        name,
        description,
        path,
    }
}

function expandHome(path: string, homeDir: string): string {
    if (path === '~') return homeDir
    if (path.startsWith('~/')) {
        return join(homeDir, path.slice(2))
    }
    return path
}

async function existsAsDirectory(path: string): Promise<boolean> {
    try {
        const info = await stat(path)
        return info.isDirectory()
    } catch {
        return false
    }
}

async function hasGitMarker(path: string): Promise<boolean> {
    try {
        await access(join(path, '.git'), fsConstants.F_OK)
        return true
    } catch {
        return false
    }
}

async function resolveProjectRoot(cwd: string): Promise<string> {
    const absoluteCwd = resolve(cwd)
    let cursor = absoluteCwd

    for (;;) {
        if (await hasGitMarker(cursor)) {
            return cursor
        }

        const parent = dirname(cursor)
        if (parent === cursor) {
            break
        }
        cursor = parent
    }

    return absoluteCwd
}

async function projectDotSkillRoots(projectRoot: string): Promise<string[]> {
    const roots: string[] = [join(projectRoot, '.agents', 'skills')]
    try {
        const entries = await readdir(projectRoot, { withFileTypes: true })
        const hiddenDirs = entries
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('.'))
            .map((entry) => entry.name)
            .filter((name) => name !== '.git')
            .sort((a, b) => a.localeCompare(b))

        for (const hiddenDir of hiddenDirs) {
            roots.push(join(projectRoot, hiddenDir, 'skills'))
        }
    } catch {
        return dedupePaths(roots)
    }

    return dedupePaths(roots)
}

function dedupePaths(paths: string[]): string[] {
    const result: string[] = []
    const seen = new Set<string>()
    for (const path of paths) {
        const normalized = resolve(path)
        if (seen.has(normalized)) continue
        seen.add(normalized)
        result.push(normalized)
    }
    return result
}

async function defaultSkillRoots(options: LoadSkillsOptions): Promise<string[]> {
    const cwd = options.cwd ?? process.cwd()
    const homeDir = options.homeDir ?? homedir()
    const memoHome = expandHome(options.memoHome ?? process.env.MEMO_HOME ?? join(homeDir, '.memo'), homeDir)

    const projectRoot = await resolveProjectRoot(cwd)
    const roots: string[] = await projectDotSkillRoots(projectRoot)
    // User-level global roots, ordered by priority (first wins on dedup):
    // memo home first so skills_admin writes stay the winning paths, then the
    // well-known Claude / Codex / Agents skill directories.
    roots.push(join(memoHome, 'skills'))
    roots.push(join(homeDir, '.claude', 'skills'))
    roots.push(join(homeDir, '.codex', 'skills'))
    roots.push(join(homeDir, '.agents', 'skills'))

    return dedupePaths(roots)
}

async function resolveSkillRoots(options: LoadSkillsOptions): Promise<string[]> {
    if (options.skillRoots && options.skillRoots.length > 0) {
        const homeDir = options.homeDir ?? homedir()
        const roots = options.skillRoots.map((root) => {
            const expanded = expandHome(root, homeDir)
            return isAbsolute(expanded) ? expanded : resolve(expanded)
        })
        return dedupePaths(roots)
    }
    return defaultSkillRoots(options)
}

export async function loadSkills(options: LoadSkillsOptions = {}): Promise<SkillMetadata[]> {
    const roots = await resolveSkillRoots(options)
    const projectRoot = await resolveProjectRoot(options.cwd ?? process.cwd())
    const maxSkills = Math.max(1, options.maxSkills ?? DEFAULT_MAX_SKILLS)
    const skills: SkillMetadata[] = []
    const seenPaths = new Set<string>()
    const byHash = new Map<string, SkillMetadata>()

    for (const root of roots) {
        if (!(await existsAsDirectory(root))) {
            continue
        }

        const files = await fg(`**/${SKILL_FILENAME}`, {
            cwd: root,
            absolute: true,
            onlyFiles: true,
            deep: MAX_SCAN_DEPTH,
            caseSensitiveMatch: false,
            followSymbolicLinks: true,
            suppressErrors: true,
            unique: true,
            ignore: ['**/.git/**', '**/node_modules/**'],
        })
        files.sort((a, b) => a.localeCompare(b))

        for (const path of files) {
            const normalizedPath = resolve(path)
            if (seenPaths.has(normalizedPath)) {
                continue
            }
            seenPaths.add(normalizedPath)

            let content: string
            try {
                content = await readFile(normalizedPath, 'utf-8')
            } catch {
                continue
            }

            const parsed = parseSkillFile(content, normalizedPath)
            if (!parsed) {
                continue
            }

            // Dedup by SKILL.md content hash (first root priority wins); copies
            // are registered as aliases on the winner for active_skills compat.
            const hash = sha256Hex(content)
            const existing = byHash.get(hash)
            if (existing) {
                existing.paths.push(normalizedPath)
                continue
            }

            const record: SkillMetadata = {
                ...parsed,
                paths: [normalizedPath],
                hash,
                scope: isPathInside(root, projectRoot) ? 'project' : 'global',
                sourceRoot: root,
            }
            byHash.set(hash, record)
            skills.push(record)
            if (skills.length >= maxSkills) {
                return skills
            }
        }
    }

    return skills
}

function sha256Hex(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex')
}

function isPathInside(path: string, dir: string): boolean {
    const normalizedPath = resolve(path)
    const normalizedDir = resolve(dir)
    if (normalizedPath === normalizedDir) {
        return true
    }
    return normalizedPath.startsWith(normalizedDir.endsWith(sep) ? normalizedDir : `${normalizedDir}${sep}`)
}

/**
 * Filter skills by the configured active_skills paths (absolute SKILL.md paths).
 * Undefined means all skills are active. Paths pointing at deduped-away copies
 * still activate the winner via its alias list.
 */
export function filterActiveSkills(skills: SkillMetadata[], activeSkillPaths: string[] | undefined): SkillMetadata[] {
    if (!Array.isArray(activeSkillPaths)) {
        return skills
    }
    const active = new Set(activeSkillPaths.map((item) => resolve(item)))
    return skills.filter((skill) => skill.paths.some((alias) => active.has(resolve(alias))))
}

export function buildSkillIndex(skills: SkillMetadata[]): SkillIndex {
    const byName = new Map<string, SkillMetadata[]>()
    const byPath = new Map<string, SkillMetadata>()
    const byHash = new Map<string, SkillMetadata>()
    for (const skill of skills) {
        const nameMatches = byName.get(skill.name) ?? []
        nameMatches.push(skill)
        byName.set(skill.name, nameMatches)
        for (const alias of skill.paths) {
            byPath.set(resolve(alias), skill)
        }
        byHash.set(skill.hash, skill)
    }
    return { list: skills, byName, byPath, byHash }
}

export function findSkillByName(index: SkillIndex, name: string): SkillMetadata[] {
    return index.byName.get(name) ?? []
}

export function findSkillByPath(index: SkillIndex, path: string): SkillMetadata | undefined {
    return index.byPath.get(resolve(path))
}

/** Read the SKILL.md body with the frontmatter stripped. */
export async function readSkillBody(record: SkillMetadata): Promise<string> {
    const content = await readFile(record.path, 'utf-8')
    return stripFrontmatter(content)
}

export function stripFrontmatter(content: string): string {
    const lines = content.split(/\r?\n/)
    if (lines[0]?.trim() !== '---') {
        return content.trim()
    }
    let found = 0
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]?.trim() === '---') {
            found += 1
            if (found === 2) {
                return lines
                    .slice(i + 1)
                    .join('\n')
                    .trim()
            }
        }
    }
    return content.trim()
}

export function renderSkillsSection(skills: SkillMetadata[], options: { budgetChars?: number } = {}): string | null {
    if (skills.length === 0) {
        return null
    }
    const budget = options.budgetChars ?? DEFAULT_SKILLS_BUDGET_CHARS

    const intro = [
        '## Skills',
        'A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills available in this session. To use a skill, call the `read_skill` tool with its name (or its SKILL.md path when names are ambiguous) to load the full instructions.',
        '### Available skills',
    ]
    const rules = ['### How to use skills', SKILLS_USAGE_RULES]
    const entries = skills.map((skill) => `- ${skill.name}: ${skill.description}`)

    const render = (keptEntries: string[], omitted: number): string => {
        const parts = [...intro, ...keptEntries]
        if (omitted > 0) {
            parts.push(`- (${omitted} more skills omitted due to context budget)`)
        }
        parts.push(...rules)
        return parts.join('\n')
    }

    if (render(entries, 0).length <= budget) {
        return render(entries, 0)
    }

    // Over budget: truncate descriptions fairly, then drop low-priority entries from the tail.
    const fixedCost = render([], 0).length + 1
    const entryBudget = Math.max(0, budget - fixedCost)
    if (entryBudget <= 0) {
        return render([], skills.length)
    }

    const share = Math.floor(entryBudget / skills.length)
    if (share >= MIN_ENTRY_CHARS) {
        const truncated = skills.map((skill) => {
            const maxDesc = Math.max(1, share - skill.name.length - 6)
            if (skill.description.length <= maxDesc) {
                return `- ${skill.name}: ${skill.description}`
            }
            return `- ${skill.name}: ${skill.description.slice(0, Math.max(1, maxDesc - 3)).trimEnd()}...`
        })
        let kept = truncated.length
        while (kept > 0 && render(truncated.slice(0, kept), skills.length - kept).length > budget) {
            kept -= 1
        }
        return render(truncated.slice(0, kept), skills.length - kept)
    }

    let kept = entries.length
    while (kept > 0 && render(entries.slice(0, kept), skills.length - kept).length > budget) {
        kept -= 1
    }
    return render(entries.slice(0, kept), skills.length - kept)
}
