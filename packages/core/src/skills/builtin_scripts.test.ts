import assert from 'node:assert'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, test } from 'vitest'

const execFileAsync = promisify(execFile)

const SCRIPTS_DIR = new URL('./builtin/skill-creator/scripts/', import.meta.url).pathname
const INIT_SCRIPT = join(SCRIPTS_DIR, 'init_skill.mjs')
const VALIDATE_SCRIPT = join(SCRIPTS_DIR, 'quick_validate.mjs')

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
    return dir
}

async function removeDir(path: string) {
    await rm(path, { recursive: true, force: true })
}

async function runScript(script: string, args: string[], cwd?: string) {
    try {
        const { stdout } = await execFileAsync(process.execPath, [script, ...args], { cwd })
        return { code: 0, stdout }
    } catch (error) {
        const e = error as { code?: number; stdout?: string; stderr?: string }
        return { code: e.code ?? 1, stdout: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
}

describe('init_skill.mjs', () => {
    test('creates a normalized skill directory with SKILL.md and example resources', async () => {
        const outDir = await makeTempDir('memo-scripts-init')
        try {
            const { code, stdout } = await runScript(INIT_SCRIPT, [
                'My Great Skill',
                '--path',
                outDir,
                '--resources',
                'scripts,references',
                '--examples',
            ])
            assert.strictEqual(code, 0)
            assert.match(stdout, /\[OK\] Created SKILL\.md/)
            assert.match(stdout, /\[OK\] Created scripts\/example\.mjs/)

            const skillDir = join(outDir, 'my-great-skill')
            const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
            assert.match(skillMd, /^---\nname: my-great-skill/)
            assert.ok((await readFile(join(skillDir, 'scripts', 'example.mjs'), 'utf8')).includes('my-great-skill'))
            assert.ok((await readFile(join(skillDir, 'references', 'api_reference.md'), 'utf8')).length > 0)
            // assets was not requested.
            await assert.rejects(readFile(join(skillDir, 'assets', 'example_asset.txt'), 'utf8'))
        } finally {
            await removeDir(outDir)
        }
    })

    test('rejects an existing skill directory', async () => {
        const outDir = await makeTempDir('memo-scripts-init')
        try {
            await mkdir(join(outDir, 'taken'), { recursive: true })
            const { code, stdout } = await runScript(INIT_SCRIPT, ['taken', '--path', outDir])
            assert.strictEqual(code, 1)
            assert.match(stdout, /already exists/)
        } finally {
            await removeDir(outDir)
        }
    })

    test('requires --path', async () => {
        const { code, stdout } = await runScript(INIT_SCRIPT, ['some-skill'])
        assert.strictEqual(code, 1)
        assert.match(stdout, /--path is required/)
    })

    test('rejects unknown resource types', async () => {
        const outDir = await makeTempDir('memo-scripts-init')
        try {
            const { code, stdout } = await runScript(INIT_SCRIPT, [
                'ok-skill',
                '--path',
                outDir,
                '--resources',
                'scripts,bogus',
            ])
            assert.strictEqual(code, 1)
            assert.match(stdout, /Unknown resource type/)
        } finally {
            await removeDir(outDir)
        }
    })

    test('rejects names longer than 64 characters', async () => {
        const outDir = await makeTempDir('memo-scripts-init')
        try {
            const longName = 'a'.repeat(65)
            const { code, stdout } = await runScript(INIT_SCRIPT, [longName, '--path', outDir])
            assert.strictEqual(code, 1)
            assert.match(stdout, /too long/)
        } finally {
            await removeDir(outDir)
        }
    })

    test('requires --resources when --examples is set', async () => {
        const outDir = await makeTempDir('memo-scripts-init')
        try {
            const { code, stdout } = await runScript(INIT_SCRIPT, ['ok-skill', '--path', outDir, '--examples'])
            assert.strictEqual(code, 1)
            assert.match(stdout, /--examples requires --resources/)
        } finally {
            await removeDir(outDir)
        }
    })
})

describe('quick_validate.mjs', () => {
    async function writeSkill(skillMd: string): Promise<string> {
        const dir = await makeTempDir('memo-scripts-validate')
        await writeFile(join(dir, 'SKILL.md'), skillMd, 'utf8')
        return dir
    }

    test('passes the output of init_skill.mjs', async () => {
        const outDir = await makeTempDir('memo-scripts-validate')
        try {
            const init = await runScript(INIT_SCRIPT, [
                'demo-skill',
                '--path',
                outDir,
                '--resources',
                'scripts',
                '--examples',
            ])
            assert.strictEqual(init.code, 0)

            const { code, stdout } = await runScript(VALIDATE_SCRIPT, [join(outDir, 'demo-skill')])
            assert.strictEqual(code, 0)
            assert.match(stdout, /Skill is valid!/)
        } finally {
            await removeDir(outDir)
        }
    })

    test('rejects a missing description', async () => {
        const dir = await writeSkill('---\nname: ok\n---\n# body\n')
        try {
            const { code, stdout } = await runScript(VALIDATE_SCRIPT, [dir])
            assert.strictEqual(code, 1)
            assert.match(stdout, /Missing 'description'/)
        } finally {
            await removeDir(dir)
        }
    })

    test('rejects a name with uppercase letters', async () => {
        const dir = await writeSkill('---\nname: MySkill\ndescription: d\n---\n')
        try {
            const { code, stdout } = await runScript(VALIDATE_SCRIPT, [dir])
            assert.strictEqual(code, 1)
            assert.match(stdout, /hyphen-case/)
        } finally {
            await removeDir(dir)
        }
    })

    test('rejects angle brackets in the description', async () => {
        const dir = await writeSkill('---\nname: ok\ndescription: "a < b"\n---\n')
        try {
            const { code, stdout } = await runScript(VALIDATE_SCRIPT, [dir])
            assert.strictEqual(code, 1)
            assert.match(stdout, /angle brackets/)
        } finally {
            await removeDir(dir)
        }
    })

    test('rejects unexpected frontmatter keys', async () => {
        const dir = await writeSkill('---\nname: ok\ndescription: d\nfoo: bar\n---\n')
        try {
            const { code, stdout } = await runScript(VALIDATE_SCRIPT, [dir])
            assert.strictEqual(code, 1)
            assert.match(stdout, /Unexpected key/)
        } finally {
            await removeDir(dir)
        }
    })

    test('reports a missing SKILL.md', async () => {
        const dir = await makeTempDir('memo-scripts-validate')
        try {
            const { code, stdout } = await runScript(VALIDATE_SCRIPT, [dir])
            assert.strictEqual(code, 1)
            assert.match(stdout, /SKILL\.md not found/)
        } finally {
            await removeDir(dir)
        }
    })
})
