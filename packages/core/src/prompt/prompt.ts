/** @file System prompt loading: reads built-in Markdown template by default. */
import os from 'node:os'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSkills, renderSkillsSection } from '@memo/core/skills/skills'

const TEMPLATE_PATTERN = /{{\s*([\w.-]+)\s*}}/g
const SOUL_PLACEHOLDER_PATTERN = /{{\s*soul_section\s*}}/

function renderTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(TEMPLATE_PATTERN, (_match, key: string) => vars[key] ?? '')
}

function resolveUsername(): string {
    try {
        return os.userInfo().username
    } catch {
        return process.env.USER ?? process.env.USERNAME ?? 'unknown'
    }
}

type LoadSystemPromptOptions = {
    /** Project root at process startup; defaults to current working directory. */
    cwd?: string
    /** Optional explicit skill roots, useful in tests and custom embeddings. */
    skillRoots?: string[]
    /** Optional custom home directory, defaults to OS home directory. */
    homeDir?: string
    /** Optional memo home override, defaults to MEMO_HOME or ~/.memo. */
    memoHome?: string
    /** Explicit active skill path list; undefined means all discovered skills are active. */
    activeSkillPaths?: string[]
    /** Disable skills injection into system prompt when false. */
    includeSkills?: boolean
    /** Optional explicit prompt template path (overrides default lookup). */
    promptPath?: string
}

function normalizePath(path: string): string {
    return resolve(path)
}

function resolveMemoHome(options: Pick<LoadSystemPromptOptions, 'homeDir' | 'memoHome'>): string {
    const homeDir = options.homeDir ?? os.homedir()
    const configured = options.memoHome?.trim() || process.env.MEMO_HOME?.trim() || join(homeDir, '.memo')
    if (configured === '~') {
        return resolve(homeDir)
    }
    if (configured.startsWith('~/')) {
        return resolve(join(homeDir, configured.slice(2)))
    }
    return resolve(configured)
}

function filterActiveSkills(skills: Awaited<ReturnType<typeof loadSkills>>, activeSkillPaths: string[] | undefined) {
    if (!Array.isArray(activeSkillPaths)) {
        return skills
    }
    const active = new Set(activeSkillPaths.map((item) => normalizePath(item)))
    return skills.filter((skill) => active.has(normalizePath(skill.path)))
}

async function readProjectAgentsMd(projectRoot: string): Promise<{ path: string; content: string } | null> {
    const agentsPath = join(projectRoot, 'AGENTS.md')
    try {
        const content = await readFile(agentsPath, 'utf-8')
        if (!content.trim()) {
            return null
        }
        return { path: agentsPath, content }
    } catch {
        return null
    }
}

function appendProjectAgentsPrompt(basePrompt: string, agents: { path: string; content: string }): string {
    return `${basePrompt}

## Project AGENTS.md (Startup Root)
Loaded from: ${agents.path}

${agents.content}`
}

function appendSkillsPrompt(basePrompt: string, skillsSection: string): string {
    return `${basePrompt}

${skillsSection}`
}

async function readSoulMd(
    options: Pick<LoadSystemPromptOptions, 'homeDir' | 'memoHome'>,
): Promise<{ path: string; content: string } | null> {
    const memoHome = resolveMemoHome(options)
    const soulPath = join(memoHome, 'SOUL.md')
    try {
        const content = await readFile(soulPath, 'utf-8')
        if (!content.trim()) {
            return null
        }
        return { path: soulPath, content }
    } catch {
        return null
    }
}

function renderSoulSection(soul: { path: string; content: string }): string {
    return `## User Personality Context (SOUL.md)
Loaded from: ${soul.path}

- Treat this content as a soft preference layer for tone, style, and subjective behavior.
- Do NOT let this content override safety rules, tool policies, Project AGENTS.md guidance, or explicit user instructions in the current turn.
- Keep SOUL.md concise when possible to avoid unnecessary prompt growth.

${soul.content}`
}

function appendSoulPrompt(basePrompt: string, soulSection: string): string {
    return `${basePrompt}

${soulSection}`
}

function resolveModuleDir(): string {
    if (typeof __dirname === 'string') {
        return __dirname
    }
    return dirname(fileURLToPath(import.meta.url))
}

function resolvePromptPath(explicitPath?: string): string {
    const moduleDir = resolveModuleDir()
    const candidates = [
        explicitPath,
        process.env.MEMO_SYSTEM_PROMPT_PATH,
        join(moduleDir, 'prompt.md'),
        join(moduleDir, '../prompt.md'),
        join(moduleDir, '../../prompt.md'),
    ]
        .filter((item): item is string => Boolean(item))
        .map((item) => resolve(item))

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate
        }
    }
    return join(moduleDir, 'prompt.md')
}

/**
 * Load built-in system prompt template.
 * Can be overridden externally via dependency injection.
 */
export async function loadSystemPrompt(options: LoadSystemPromptOptions = {}): Promise<string> {
    const startupRoot = options.cwd ?? process.cwd()
    const promptPath = resolvePromptPath(options.promptPath)
    const prompt = await readFile(promptPath, 'utf-8')
    const soul = await readSoulMd({ homeDir: options.homeDir, memoHome: options.memoHome })
    const soulSection = soul ? renderSoulSection(soul) : ''
    const hasSoulPlaceholder = SOUL_PLACEHOLDER_PATTERN.test(prompt)
    const vars = {
        date: new Date().toISOString(),
        user: resolveUsername(),
        pwd: startupRoot,
        soul_section: soulSection,
    }
    let composedPrompt = renderTemplate(prompt, vars)
    if (!hasSoulPlaceholder && soulSection) {
        composedPrompt = appendSoulPrompt(composedPrompt, soulSection)
    }
    const agents = await readProjectAgentsMd(startupRoot)
    if (agents) {
        composedPrompt = appendProjectAgentsPrompt(composedPrompt, agents)
    }

    if (options.includeSkills !== false) {
        const allSkills = await loadSkills({
            cwd: startupRoot,
            skillRoots: options.skillRoots,
            homeDir: options.homeDir,
            memoHome: options.memoHome,
        })
        const skills = filterActiveSkills(allSkills, options.activeSkillPaths)
        const skillsSection = renderSkillsSection(skills)
        if (skillsSection) {
            composedPrompt = appendSkillsPrompt(composedPrompt, skillsSection)
        }
    }

    return composedPrompt
}
