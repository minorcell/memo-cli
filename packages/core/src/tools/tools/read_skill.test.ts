import assert from 'node:assert'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'vitest'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import { buildSkillIndex, loadSkills } from '@memo/core/skills/skills'
import type { SkillIndex } from '@memo/core/skills/skills'
import { readSkillTool } from '@memo/core/tools/tools/read_skill'

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

async function buildIndexFor({ projectRoot, homeDir }: { projectRoot: string; homeDir: string }): Promise<SkillIndex> {
    const memoHome = join(homeDir, '.memo')
    await mkdir(homeDir, { recursive: true })
    await mkdir(memoHome, { recursive: true })
    await writeFile(join(projectRoot, '.git'), 'gitdir: test\n', 'utf-8')
    const discovered = await loadSkills({ cwd: projectRoot, homeDir, memoHome })
    return buildSkillIndex(discovered)
}

function callTool(input: unknown, index: SkillIndex): Promise<ToolResultOutput> {
    return readSkillTool.execute!(
        input as never,
        {
            experimental_context: { skillIndex: index },
        } as never,
    ) as Promise<ToolResultOutput>
}

describe('read_skill tool', () => {
    test('reads a skill body with frontmatter stripped and reports skill_directory', async () => {
        const sandbox = await makeTempDir('memo-read-skill')
        const projectRoot = join(sandbox, 'repo')
        await mkdir(projectRoot, { recursive: true })
        await writeSkill(
            join(projectRoot, '.agents', 'skills'),
            'fmt',
            'formatting helper',
            '# Fmt\n\nRun `scripts/format.sh` relative to this skill directory.\n',
        )
        try {
            const index = await buildIndexFor({ projectRoot, homeDir: join(sandbox, 'home') })
            const result = await callTool({ name: 'fmt' }, index)
            assert.strictEqual(result.type, 'text')
            const payload = JSON.parse(result.value)
            assert.strictEqual(payload.name, 'fmt')
            assert.ok(payload.skill_directory.endsWith(join('.agents', 'skills', 'fmt')))
            assert.ok(payload.content.includes('scripts/format.sh'))
            assert.ok(!payload.content.includes('description: formatting helper'))
        } finally {
            await removeDir(sandbox)
        }
    })

    test('returns not-found with available names', async () => {
        const sandbox = await makeTempDir('memo-read-skill-missing')
        const projectRoot = join(sandbox, 'repo')
        await mkdir(projectRoot, { recursive: true })
        await writeSkill(join(projectRoot, '.agents', 'skills'), 'only-one', 'only skill')
        try {
            const index = await buildIndexFor({ projectRoot, homeDir: join(sandbox, 'home') })
            const result = await callTool({ name: 'nope' }, index)
            assert.strictEqual(result.type, 'error-text')
            assert.ok(result.value.includes('nope'))
            assert.ok(result.value.includes('only-one'))
        } finally {
            await removeDir(sandbox)
        }
    })

    test('reports ambiguity with candidate paths when a name matches multiple skills', async () => {
        const sandbox = await makeTempDir('memo-read-skill-ambiguous')
        const projectRoot = join(sandbox, 'repo')
        const homeDir = join(sandbox, 'home')
        await mkdir(projectRoot, { recursive: true })
        await writeSkill(join(projectRoot, '.agents', 'skills'), 'clash', 'project version')
        await writeSkill(join(homeDir, '.claude', 'skills'), 'clash', 'global version')
        try {
            const index = await buildIndexFor({ projectRoot, homeDir })
            const result = await callTool({ name: 'clash' }, index)
            assert.strictEqual(result.type, 'error-text')
            assert.ok(result.value.includes('ambiguous'))
            assert.ok(result.value.includes('.agents/skills/clash/SKILL.md'))
            assert.ok(result.value.includes('.claude/skills/clash/SKILL.md'))
        } finally {
            await removeDir(sandbox)
        }
    })

    test('resolves a path even when it points at a deduped-away copy', async () => {
        const sandbox = await makeTempDir('memo-read-skill-path')
        const projectRoot = join(sandbox, 'repo')
        const homeDir = join(sandbox, 'home')
        await mkdir(projectRoot, { recursive: true })
        const projectPath = await writeSkill(join(projectRoot, '.agents', 'skills'), 'shared', 'same skill')
        const homePath = await writeSkill(join(homeDir, '.claude', 'skills'), 'shared', 'same skill')
        try {
            const index = await buildIndexFor({ projectRoot, homeDir })
            const result = await callTool({ path: homePath }, index)
            assert.strictEqual(result.type, 'text')
            const payload = JSON.parse(result.value)
            assert.strictEqual(payload.name, 'shared')
            assert.ok(payload.skill_directory.endsWith(join('.agents', 'skills', 'shared')), 'winner directory')
            void projectPath
        } finally {
            await removeDir(sandbox)
        }
    })

    test('falls back to a fresh scan when context has no skillIndex', async () => {
        const sandbox = await makeTempDir('memo-read-skill-fallback')
        const homeDir = join(sandbox, 'home')
        const memoHome = join(homeDir, '.memo')
        await mkdir(memoHome, { recursive: true })
        await writeSkill(join(memoHome, 'skills'), 'fallback', 'fallback skill')
        process.env.MEMO_HOME = memoHome
        try {
            const result = (await readSkillTool.execute!(
                { name: 'fallback' } as never,
                {
                    experimental_context: {},
                } as never,
            )) as ToolResultOutput
            assert.strictEqual(result.type, 'text')
            const payload = JSON.parse(result.value)
            assert.strictEqual(payload.name, 'fallback')
        } finally {
            delete process.env.MEMO_HOME
            await removeDir(sandbox)
        }
    })
})
