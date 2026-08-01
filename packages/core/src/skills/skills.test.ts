import assert from 'node:assert'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'vitest'
import {
    DEFAULT_SKILLS_BUDGET_CHARS,
    buildSkillIndex,
    findSkillByName,
    findSkillByPath,
    loadSkills,
    readSkillBody,
    renderSkillsSection,
    stripFrontmatter,
} from '@memo/core/skills/skills'

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
    return dir
}

async function removeDir(path: string) {
    await rm(path, { recursive: true, force: true })
}

async function writeSkill(skillRoot: string, skillName: string, description: string, body?: string) {
    const skillDir = join(skillRoot, skillName)
    const skillPath = join(skillDir, 'SKILL.md')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
        skillPath,
        `---
name: ${skillName}
description: ${description}
---
${body ?? `# ${skillName}\n`}`,
        'utf-8',
    )
    return skillPath
}

describe('skills discovery', () => {
    test('discovers project .xxx/skills plus user-level ~/.memo, ~/.claude, ~/.codex, ~/.agents skills', async () => {
        const sandbox = await makeTempDir('memo-core-skills-discovery')
        const projectRoot = join(sandbox, 'repo')
        const nestedCwd = join(projectRoot, 'packages', 'core')
        const homeDir = join(sandbox, 'home')
        const memoHome = join(homeDir, '.memo')

        await mkdir(nestedCwd, { recursive: true })
        await mkdir(homeDir, { recursive: true })
        await writeFile(join(projectRoot, '.git'), 'gitdir: test\n', 'utf-8')

        await writeSkill(join(projectRoot, '.agents', 'skills'), 'memo-default', 'memo default')
        await writeSkill(join(projectRoot, '.claude', 'skills'), 'claude-compat', 'claude compat')
        await writeSkill(join(projectRoot, '.codex', 'skills'), 'codex-compat', 'codex compat')
        await writeSkill(join(memoHome, 'skills'), 'memo-global', 'memo global')

        // User-level global directories must be discovered.
        await writeSkill(join(homeDir, '.agents', 'skills'), 'home-agents', 'home agents')
        await writeSkill(join(homeDir, '.codex', 'skills'), 'home-codex', 'home codex')
        await writeSkill(join(homeDir, '.claude', 'skills'), 'home-claude', 'home claude')

        try {
            const discovered = await loadSkills({ cwd: nestedCwd, homeDir, memoHome })
            const names = new Set(discovered.map((skill) => skill.name))

            assert.ok(names.has('memo-default'))
            assert.ok(names.has('claude-compat'))
            assert.ok(names.has('codex-compat'))
            assert.ok(names.has('memo-global'))
            assert.ok(names.has('home-agents'))
            assert.ok(names.has('home-codex'))
            assert.ok(names.has('home-claude'))
        } finally {
            await removeDir(sandbox)
        }
    })

    test('falls back to cwd when no git root exists', async () => {
        const sandbox = await makeTempDir('memo-core-skills-no-git')
        const parentDir = join(sandbox, 'parent')
        const cwd = join(parentDir, 'child')
        const homeDir = join(sandbox, 'home')
        const memoHome = join(homeDir, '.memo')

        await mkdir(cwd, { recursive: true })
        await mkdir(homeDir, { recursive: true })

        await writeSkill(join(parentDir, '.agents', 'skills'), 'parent-skill', 'parent level')
        await writeSkill(join(cwd, '.agents', 'skills'), 'cwd-skill', 'cwd level')

        try {
            const discovered = await loadSkills({ cwd, homeDir, memoHome })
            const names = new Set(discovered.map((skill) => skill.name))

            assert.ok(names.has('cwd-skill'))
            assert.ok(!names.has('parent-skill'))
        } finally {
            await removeDir(sandbox)
        }
    })
})

describe('skills dedup', () => {
    test('identical SKILL.md in project and user roots dedupes to a single record, project wins', async () => {
        const sandbox = await makeTempDir('memo-core-skills-dedup-project')
        const projectRoot = join(sandbox, 'repo')
        const homeDir = join(sandbox, 'home')
        const memoHome = join(homeDir, '.memo')

        await mkdir(projectRoot, { recursive: true })
        await mkdir(homeDir, { recursive: true })
        await writeFile(join(projectRoot, '.git'), 'gitdir: test\n', 'utf-8')

        const projectPath = await writeSkill(join(projectRoot, '.agents', 'skills'), 'shared', 'same skill')
        const homePath = await writeSkill(join(homeDir, '.claude', 'skills'), 'shared', 'same skill')

        try {
            const discovered = await loadSkills({ cwd: projectRoot, homeDir, memoHome })
            assert.strictEqual(discovered.length, 1)
            const [skill] = discovered
            assert.ok(skill)
            assert.strictEqual(skill.path, projectPath)
            assert.deepStrictEqual(skill.paths, [projectPath, homePath])
            assert.strictEqual(skill.scope, 'project')
        } finally {
            await removeDir(sandbox)
        }
    })

    test('identical SKILL.md across user roots keeps memo home winner', async () => {
        const sandbox = await makeTempDir('memo-core-skills-dedup-user')
        const projectRoot = join(sandbox, 'repo')
        const homeDir = join(sandbox, 'home')
        const memoHome = join(homeDir, '.memo')

        await mkdir(projectRoot, { recursive: true })
        await mkdir(homeDir, { recursive: true })
        await writeFile(join(projectRoot, '.git'), 'gitdir: test\n', 'utf-8')

        const memoPath = await writeSkill(join(memoHome, 'skills'), 'dup', 'duplicate skill')
        const claudePath = await writeSkill(join(homeDir, '.claude', 'skills'), 'dup', 'duplicate skill')
        const codexPath = await writeSkill(join(homeDir, '.codex', 'skills'), 'dup', 'duplicate skill')
        const agentsPath = await writeSkill(join(homeDir, '.agents', 'skills'), 'dup', 'duplicate skill')

        try {
            const discovered = await loadSkills({ cwd: projectRoot, homeDir, memoHome })
            assert.strictEqual(discovered.length, 1)
            const [skill] = discovered
            assert.ok(skill)
            assert.strictEqual(skill.path, memoPath)
            assert.deepStrictEqual(skill.paths, [memoPath, claudePath, codexPath, agentsPath])
            assert.strictEqual(skill.scope, 'global')
        } finally {
            await removeDir(sandbox)
        }
    })

    test('identical SKILL.md within one root dedupes lexicographically', async () => {
        const sandbox = await makeTempDir('memo-core-skills-dedup-same-root')
        const projectRoot = join(sandbox, 'repo')
        const homeDir = join(sandbox, 'home')
        const memoHome = join(homeDir, '.memo')

        await mkdir(projectRoot, { recursive: true })
        await mkdir(homeDir, { recursive: true })
        await writeFile(join(projectRoot, '.git'), 'gitdir: test\n', 'utf-8')

        const aPath = await writeSkill(join(projectRoot, '.agents', 'skills'), 'dup-body', 'same body')
        // Second directory holds a byte-identical SKILL.md (same name).
        const zDir = join(projectRoot, '.agents', 'skills', 'z-skill')
        await mkdir(zDir, { recursive: true })
        const zPath = join(zDir, 'SKILL.md')
        await writeFile(zPath, await readFile(aPath, 'utf-8'), 'utf-8')

        try {
            const discovered = await loadSkills({ cwd: projectRoot, homeDir, memoHome })
            assert.strictEqual(discovered.length, 1)
            const [skill] = discovered
            assert.ok(skill)
            assert.strictEqual(skill.path, aPath)
            assert.deepStrictEqual(skill.paths, [aPath, zPath])
        } finally {
            await removeDir(sandbox)
        }
    })

    test('same name with different content coexists', async () => {
        const sandbox = await makeTempDir('memo-core-skills-name-clash')
        const projectRoot = join(sandbox, 'repo')
        const homeDir = join(sandbox, 'home')
        const memoHome = join(homeDir, '.memo')

        await mkdir(projectRoot, { recursive: true })
        await mkdir(homeDir, { recursive: true })
        await writeFile(join(projectRoot, '.git'), 'gitdir: test\n', 'utf-8')

        await writeSkill(join(projectRoot, '.agents', 'skills'), 'clash', 'project version')
        await writeSkill(join(memoHome, 'skills'), 'clash', 'global version')

        try {
            const discovered = await loadSkills({ cwd: projectRoot, homeDir, memoHome })
            assert.strictEqual(discovered.length, 2)
            assert.deepStrictEqual(discovered.map((s) => s.description).sort(), ['global version', 'project version'])

            const index = buildSkillIndex(discovered)
            assert.strictEqual(findSkillByName(index, 'clash').length, 2)
        } finally {
            await removeDir(sandbox)
        }
    })
})

describe('skills index and reading', () => {
    test('index resolves deduped-away copies by path', async () => {
        const sandbox = await makeTempDir('memo-core-skills-index')
        const projectRoot = join(sandbox, 'repo')
        const homeDir = join(sandbox, 'home')
        const memoHome = join(homeDir, '.memo')

        await mkdir(projectRoot, { recursive: true })
        await mkdir(homeDir, { recursive: true })
        await writeFile(join(projectRoot, '.git'), 'gitdir: test\n', 'utf-8')

        const projectPath = await writeSkill(join(projectRoot, '.agents', 'skills'), 'shared', 'same skill')
        const homePath = await writeSkill(join(homeDir, '.claude', 'skills'), 'shared', 'same skill')

        try {
            const discovered = await loadSkills({ cwd: projectRoot, homeDir, memoHome })
            const index = buildSkillIndex(discovered)

            const byWinner = findSkillByPath(index, projectPath)
            assert.strictEqual(byWinner?.name, 'shared')
            const byCopy = findSkillByPath(index, homePath)
            assert.strictEqual(byCopy?.name, 'shared')
            assert.strictEqual(byCopy?.path, projectPath)
        } finally {
            await removeDir(sandbox)
        }
    })

    test('readSkillBody strips frontmatter', async () => {
        const sandbox = await makeTempDir('memo-core-skills-read')
        const projectRoot = join(sandbox, 'repo')
        const homeDir = join(sandbox, 'home')
        const memoHome = join(homeDir, '.memo')

        await mkdir(projectRoot, { recursive: true })
        await mkdir(homeDir, { recursive: true })
        await writeFile(join(projectRoot, '.git'), 'gitdir: test\n', 'utf-8')
        await writeSkill(join(projectRoot, '.agents', 'skills'), 'bod', 'body skill', '# Bod\n\nDetails here.\n')

        try {
            const [skill] = await loadSkills({ cwd: projectRoot, homeDir, memoHome })
            assert.ok(skill)
            const body = await readSkillBody(skill)
            assert.ok(!body.includes('---'))
            assert.ok(body.includes('Details here.'))
            assert.ok(!body.includes('description: body skill'))
        } finally {
            await removeDir(sandbox)
        }
    })

    test('stripFrontmatter handles missing frontmatter', () => {
        assert.strictEqual(stripFrontmatter('# Plain\n\ncontent\n'), '# Plain\n\ncontent')
        assert.strictEqual(stripFrontmatter('---\nname: x\n---\n# Body\n'), '# Body')
    })
})

describe('skills directory rendering', () => {
    test('renders name + description without file paths', async () => {
        const sandbox = await makeTempDir('memo-core-skills-render')
        const projectRoot = join(sandbox, 'repo')
        const homeDir = join(sandbox, 'home')
        const memoHome = join(homeDir, '.memo')

        await mkdir(projectRoot, { recursive: true })
        await mkdir(homeDir, { recursive: true })
        await writeFile(join(projectRoot, '.git'), 'gitdir: test\n', 'utf-8')
        const skillPath = await writeSkill(join(projectRoot, '.agents', 'skills'), 'fmt', 'formatting helper')

        try {
            const [skill] = await loadSkills({ cwd: projectRoot, homeDir, memoHome })
            assert.ok(skill)
            const section = renderSkillsSection([skill])
            assert.ok(section)
            assert.ok(section.includes('- fmt: formatting helper'))
            assert.ok(!section.includes(skillPath))
            assert.ok(section.includes('read_skill'))
        } finally {
            await removeDir(sandbox)
        }
    })

    test('stays within budget by truncating descriptions and omitting the tail', () => {
        // Long names make each entry exceed its fair share of the budget, so
        // descriptions get truncated and low-priority entries get dropped.
        const skills = Array.from({ length: 50 }, (_, i) => ({
            name: `${String(i).padStart(3, '0')}-${'n'.repeat(47)}`,
            description: `description number ${i} `.repeat(30), // long on purpose
            path: `/tmp/skill-${i}/SKILL.md`,
            paths: [`/tmp/skill-${i}/SKILL.md`],
            hash: `h${i}`,
            scope: 'global' as const,
            sourceRoot: '/tmp',
        }))

        const section = renderSkillsSection(skills)
        assert.ok(section)
        assert.ok(section.length <= DEFAULT_SKILLS_BUDGET_CHARS)
        assert.ok(section.includes('omitted due to context budget'))
        assert.ok(section.includes('...'), 'truncated descriptions should end with ...')
    })

    test('omits all entries when budget cannot fit any entry', () => {
        const skills = [
            {
                name: 'x',
                description: 'y',
                path: '/tmp/x/SKILL.md',
                paths: ['/tmp/x/SKILL.md'],
                hash: 'h1',
                scope: 'global' as const,
                sourceRoot: '/tmp',
            },
        ]
        // Budget below the fixed header/rules cost: every entry is omitted.
        const section = renderSkillsSection(skills, { budgetChars: 100 })
        assert.ok(section)
        assert.ok(section.includes('1 more skills omitted'))
        assert.ok(!section.includes('- x: y'))
    })

    test('returns null for empty skills', () => {
        assert.strictEqual(renderSkillsSection([]), null)
    })
})
