import { access, readFile, readdir, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import fg from 'fast-glob'

export type SkillMetadata = {
    name: string
    description: string
    path: string
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

const SKILLS_USAGE_RULES = `- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill (with \`$SkillName\` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, open its \`SKILL.md\`. Read only enough to follow the workflow.
  2) When \`SKILL.md\` references relative paths (e.g., \`scripts/foo.py\`), resolve them relative to the skill directory listed above first, and only consider other paths if needed.
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
            const match = line.match(new RegExp(`^${key}\\s*:\\s*[|>]\\s*$`))
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

function parseSkillFile(content: string, path: string): SkillMetadata | null {
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
    roots.push(join(memoHome, 'skills'))

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
    const maxSkills = Math.max(1, options.maxSkills ?? DEFAULT_MAX_SKILLS)
    const skills: SkillMetadata[] = []
    const seenPaths = new Set<string>()

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

            skills.push(parsed)
            seenPaths.add(normalizedPath)
            if (skills.length >= maxSkills) {
                return skills
            }
        }
    }

    return skills
}

export function renderSkillsSection(skills: SkillMetadata[]): string | null {
    if (skills.length === 0) {
        return null
    }

    const lines: string[] = []
    lines.push('## Skills')
    lines.push(
        'A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.',
    )
    lines.push('### Available skills')
    for (const skill of skills) {
        lines.push(`- ${skill.name}: ${skill.description} (file: ${skill.path})`)
    }
    lines.push('### How to use skills')
    lines.push(SKILLS_USAGE_RULES)
    return lines.join('\n')
}
