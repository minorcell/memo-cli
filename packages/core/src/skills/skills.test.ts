import assert from 'node:assert'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'vitest'
import { loadSkills } from '@memo/core/skills/skills'

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
    return dir
}

async function removeDir(path: string) {
    await rm(path, { recursive: true, force: true })
}

async function writeSkill(skillRoot: string, skillName: string, description: string) {
    const skillDir = join(skillRoot, skillName)
    const skillPath = join(skillDir, 'SKILL.md')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
        skillPath,
        `---
name: ${skillName}
description: ${description}
---
# ${skillName}
`,
        'utf-8',
    )
    return skillPath
}

describe('skills discovery', () => {
    test('discovers project .xxx/skills and ~/.memo/skills only', async () => {
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

        // Should NOT be discovered: non-memo home hidden directories.
        await writeSkill(join(homeDir, '.agents', 'skills'), 'home-agents', 'home agents')
        await writeSkill(join(homeDir, '.codex', 'skills'), 'home-codex', 'home codex')

        try {
            const discovered = await loadSkills({ cwd: nestedCwd, homeDir, memoHome })
            const names = new Set(discovered.map((skill) => skill.name))

            assert.ok(names.has('memo-default'))
            assert.ok(names.has('claude-compat'))
            assert.ok(names.has('codex-compat'))
            assert.ok(names.has('memo-global'))
            assert.ok(!names.has('home-agents'))
            assert.ok(!names.has('home-codex'))
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
