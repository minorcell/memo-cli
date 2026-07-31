import assert from 'node:assert'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { loadMemoConfig, writeMemoConfig, type MemoConfig } from '../config/config'
import {
    SkillsAdminError,
    createSkill,
    getSkill,
    listSkills,
    removeSkill,
    setActiveSkills,
    updateSkill,
} from './skills_admin'

const tempRoots: string[] = []

type EnvSnapshot = {
    memoHome: string | undefined
}

function snapshotEnv(): EnvSnapshot {
    return {
        memoHome: process.env.MEMO_HOME,
    }
}

function restoreEnv(snapshot: EnvSnapshot): void {
    if (snapshot.memoHome === undefined) delete process.env.MEMO_HOME
    else process.env.MEMO_HOME = snapshot.memoHome
}

async function setupMemoHome(suffix: string, configOverrides: Partial<MemoConfig> = {}) {
    const home = await mkdtemp(join(tmpdir(), `memo-skills-${suffix}-`))
    tempRoots.push(home)
    process.env.MEMO_HOME = home

    const configPath = join(home, 'config.toml')
    const config: MemoConfig = {
        current_provider: 'openai',
        providers: [
            {
                name: 'openai',
                env_api_key: 'OPENAI_API_KEY',
                model: 'gpt-4.1-mini',
            },
        ],
        mcp_servers: {},
        ...configOverrides,
    }
    await writeMemoConfig(configPath, config)
    return { home, configPath }
}

function encode(path: string): string {
    return Buffer.from(path, 'utf8').toString('base64url')
}

afterEach(async () => {
    while (tempRoots.length > 0) {
        const root = tempRoots.pop()
        if (!root) continue
        await rm(root, { recursive: true, force: true })
    }
})

describe('skills_admin', () => {
    test('creates, lists and gets global skills with query filtering', async () => {
        const env = snapshotEnv()
        await setupMemoHome('global')

        try {
            const created = await createSkill({
                scope: 'global',
                name: 'doc-writing',
                description: 'Generate and update documentation',
            })
            assert.strictEqual(created.created, true)
            assert.strictEqual(created.item.scope, 'global')
            assert.strictEqual(created.item.active, true)

            const all = await listSkills({})
            assert.strictEqual(all.items.length, 1)
            assert.strictEqual(all.items[0]?.name, 'doc-writing')

            const filtered = await listSkills({ q: 'documentation' })
            assert.strictEqual(filtered.items.length, 1)

            const detail = await getSkill(created.item.id)
            assert.strictEqual(detail.name, 'doc-writing')
            assert.ok(detail.content.includes('name: doc-writing'))
            assert.ok(detail.content.includes('description: Generate and update documentation'))

            await expect(listSkills({ scope: 'project' })).rejects.toMatchObject({
                code: 'BAD_REQUEST',
            })
            await expect(getSkill('%%%')).rejects.toBeInstanceOf(SkillsAdminError)
        } finally {
            restoreEnv(env)
        }
    })

    test('supports project scope create/update/remove with allowed roots', async () => {
        const env = snapshotEnv()
        const workspace = await mkdtemp(join(tmpdir(), 'memo-skills-workspace-'))
        tempRoots.push(workspace)
        await setupMemoHome('project')

        try {
            const created = await createSkill({
                scope: 'project',
                name: 'workspace-skill',
                description: 'workspace description',
                workspaceCwd: workspace,
            })

            const listed = await listSkills({ scope: 'project', workspaceCwd: workspace })
            assert.strictEqual(listed.items.length, 1)
            assert.strictEqual(listed.items[0]?.scope, 'project')

            await updateSkill(
                created.item.id,
                {
                    description: 'updated description',
                    content: '# Workspace Skill\n\nupdated body',
                },
                { workspaceCwds: [workspace] },
            )

            const detail = await getSkill(created.item.id, { workspaceCwds: [workspace] })
            assert.strictEqual(detail.description, 'updated description')
            assert.ok(detail.content.includes('updated body'))

            await removeSkill(created.item.id, { workspaceCwds: [workspace] })
            await expect(getSkill(created.item.id, { workspaceCwds: [workspace] })).rejects.toMatchObject({
                code: 'NOT_FOUND',
            })
        } finally {
            restoreEnv(env)
        }
    })

    test('setActiveSkills filters invalid, duplicate, missing and out-of-root ids', async () => {
        const env = snapshotEnv()
        const { home } = await setupMemoHome('active-selection', { active_skills: [] })

        try {
            const first = await createSkill({
                scope: 'global',
                name: 'first',
                description: 'first desc',
            })
            const second = await createSkill({
                scope: 'global',
                name: 'second',
                description: 'second desc',
            })

            const outsideId = encode('/tmp/outside/SKILL.md')
            const notSkillId = encode(join(home, 'skills', 'first', 'README.md'))
            const missingId = encode(join(home, 'skills', 'missing', 'SKILL.md'))

            const result = await setActiveSkills([
                first.item.id,
                first.item.id,
                second.item.id,
                outsideId,
                notSkillId,
                missingId,
                '%%%invalid',
                '',
            ])

            assert.deepStrictEqual(result.active, [first.item.id, second.item.id])

            const loaded = await loadMemoConfig()
            assert.deepStrictEqual(loaded.config.active_skills, [first.item.path, second.item.path])
        } finally {
            restoreEnv(env)
        }
    })

    test('removeSkill updates explicit active selection and rejects duplicate create', async () => {
        const env = snapshotEnv()
        await setupMemoHome('remove-active', { active_skills: [] })

        try {
            const created = await createSkill({
                scope: 'global',
                name: 'cleanup-target',
                description: 'cleanup',
            })

            await setActiveSkills([created.item.id])
            const before = await loadMemoConfig()
            assert.deepStrictEqual(before.config.active_skills, [created.item.path])

            await expect(
                createSkill({ scope: 'global', name: 'cleanup-target', description: 'dup' }),
            ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

            await removeSkill(created.item.id)

            await expect(access(created.item.path)).rejects.toBeDefined()

            const after = await loadMemoConfig()
            assert.deepStrictEqual(after.config.active_skills, [])
        } finally {
            restoreEnv(env)
        }
    })
})
