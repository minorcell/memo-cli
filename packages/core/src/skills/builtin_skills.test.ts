import assert from 'node:assert'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'vitest'
import { BUILTIN_MARKER, installBuiltinSkills, resolveBuiltinRoot } from '@memo/core/skills/builtin_skills'

const SKILL_MD_V1 = `---
name: skill-creator
description: v1 description
---
# v1 body
`

const SKILL_MD_V2 = `---
name: skill-creator
description: v2 description
---
# v2 body
`

const INIT_SCRIPT_V1 = "export const version = 'v1'\n"
const INIT_SCRIPT_V2 = "export const version = 'v2'\n"

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
    return dir
}

async function removeDir(path: string) {
    await rm(path, { recursive: true, force: true })
}

async function makeSource(skillName: string, skillMd: string, initScript: string) {
    const root = await makeTempDir('memo-builtin-src')
    const skillDir = join(root, skillName)
    await mkdir(join(skillDir, 'scripts'), { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), skillMd, 'utf8')
    await writeFile(join(skillDir, 'scripts', 'init_skill.mjs'), initScript, 'utf8')
    return root
}

describe('installBuiltinSkills', () => {
    test('installs missing skills with a marker recording the tree fingerprint', async () => {
        const memoHome = await makeTempDir('memo-builtin-home')
        const source = await makeSource('skill-creator', SKILL_MD_V1, INIT_SCRIPT_V1)
        try {
            await installBuiltinSkills({ memoHome, sourceRoot: source })

            const skillDir = join(memoHome, 'skills', 'skill-creator')
            const installed = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
            assert.strictEqual(installed, SKILL_MD_V1)
            const installedScript = await readFile(join(skillDir, 'scripts', 'init_skill.mjs'), 'utf8')
            assert.strictEqual(installedScript, INIT_SCRIPT_V1)

            const marker = await readFile(join(skillDir, BUILTIN_MARKER), 'utf8')
            assert.match(marker, /^[0-9a-f]{64}$/, 'marker should be a sha256 hex fingerprint')
        } finally {
            await removeDir(memoHome)
            await removeDir(source)
        }
    })

    test('is idempotent: unchanged trees are left untouched on reinstall', async () => {
        const memoHome = await makeTempDir('memo-builtin-home')
        const source = await makeSource('skill-creator', SKILL_MD_V1, INIT_SCRIPT_V1)
        try {
            await installBuiltinSkills({ memoHome, sourceRoot: source })
            const skillDir = join(memoHome, 'skills', 'skill-creator')
            const markerPath = join(skillDir, BUILTIN_MARKER)
            const markerBefore = await readFile(markerPath, 'utf8')

            await installBuiltinSkills({ memoHome, sourceRoot: source })

            const markerAfter = await readFile(markerPath, 'utf8')
            assert.strictEqual(markerAfter, markerBefore)
            const installed = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
            assert.strictEqual(installed, SKILL_MD_V1)
        } finally {
            await removeDir(memoHome)
            await removeDir(source)
        }
    })

    test('skips directories modified by the user', async () => {
        const memoHome = await makeTempDir('memo-builtin-home')
        const source = await makeSource('skill-creator', SKILL_MD_V1, INIT_SCRIPT_V1)
        try {
            await installBuiltinSkills({ memoHome, sourceRoot: source })

            const skillDir = join(memoHome, 'skills', 'skill-creator')
            const userEdit = '# my own edit\n'
            await writeFile(join(skillDir, 'SKILL.md'), userEdit, 'utf8')
            const markerBefore = await readFile(join(skillDir, BUILTIN_MARKER), 'utf8')

            await installBuiltinSkills({ memoHome, sourceRoot: source })

            const installed = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
            assert.strictEqual(installed, userEdit, 'user edit must survive reinstall')
            const markerAfter = await readFile(join(skillDir, BUILTIN_MARKER), 'utf8')
            assert.strictEqual(markerAfter, markerBefore, 'marker must not be rewritten')
        } finally {
            await removeDir(memoHome)
            await removeDir(source)
        }
    })

    test('upgrades untouched copies from an older release, including bundled scripts', async () => {
        const memoHome = await makeTempDir('memo-builtin-home')
        const sourceV1 = await makeSource('skill-creator', SKILL_MD_V1, INIT_SCRIPT_V1)
        try {
            await installBuiltinSkills({ memoHome, sourceRoot: sourceV1 })

            // Simulate a newer release: new content in SKILL.md AND in scripts.
            const sourceV2 = await makeSource('skill-creator', SKILL_MD_V2, INIT_SCRIPT_V2)
            await installBuiltinSkills({ memoHome, sourceRoot: sourceV2 })

            const skillDir = join(memoHome, 'skills', 'skill-creator')
            const installed = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
            assert.strictEqual(installed, SKILL_MD_V2, 'untouched old copy should be upgraded')
            const installedScript = await readFile(join(skillDir, 'scripts', 'init_skill.mjs'), 'utf8')
            assert.strictEqual(installedScript, INIT_SCRIPT_V2, 'script changes must propagate too')

            const marker = await readFile(join(skillDir, BUILTIN_MARKER), 'utf8')
            // Reinstalling the new source must now be a no-op.
            await installBuiltinSkills({ memoHome, sourceRoot: sourceV2 })
            const markerAfter = await readFile(join(skillDir, BUILTIN_MARKER), 'utf8')
            assert.strictEqual(markerAfter, marker)
            await removeDir(sourceV2)
        } finally {
            await removeDir(memoHome)
            await removeDir(sourceV1)
        }
    })

    test('does not touch externally created directories without a marker', async () => {
        const memoHome = await makeTempDir('memo-builtin-home')
        const source = await makeSource('skill-creator', SKILL_MD_V1, INIT_SCRIPT_V1)
        try {
            const skillDir = join(memoHome, 'skills', 'skill-creator')
            await mkdir(skillDir, { recursive: true })
            const foreign = '# foreign skill\n'
            await writeFile(join(skillDir, 'SKILL.md'), foreign, 'utf8')

            await installBuiltinSkills({ memoHome, sourceRoot: source })

            const installed = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
            assert.strictEqual(installed, foreign, 'foreign install must not be overwritten')
        } finally {
            await removeDir(memoHome)
            await removeDir(source)
        }
    })

    test('creates memoHome/skills when memoHome does not exist yet', async () => {
        const sandbox = await makeTempDir('memo-builtin-sandbox')
        const source = await makeSource('skill-creator', SKILL_MD_V1, INIT_SCRIPT_V1)
        try {
            const memoHome = join(sandbox, 'nested', 'home')
            await installBuiltinSkills({ memoHome, sourceRoot: source })

            const installed = await readFile(join(memoHome, 'skills', 'skill-creator', 'SKILL.md'), 'utf8')
            assert.strictEqual(installed, SKILL_MD_V1)
        } finally {
            await removeDir(sandbox)
            await removeDir(source)
        }
    })

    test('resolveBuiltinRoot finds the in-repo builtin tree', async () => {
        const root = resolveBuiltinRoot()
        // In the source tree, the builtin skill lives next to this module.
        const moduleDir = dirname(fileURLToPath(import.meta.url))
        const expected = join(moduleDir, 'builtin')
        assert.strictEqual(root, expected)
        assert.ok((await readFile(join(root, 'skill-creator', 'SKILL.md'), 'utf8')).startsWith('---'))
    })
})
