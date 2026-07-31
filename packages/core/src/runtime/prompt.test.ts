import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { loadSystemPrompt } from './prompt'

const createdDirs: string[] = []

afterEach(async () => {
    delete process.env.MEMO_SYSTEM_PROMPT_PATH
    delete process.env.MEMO_HOME
    await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(os.tmpdir(), prefix))
    createdDirs.push(dir)
    return dir
}

describe('loadSystemPrompt', () => {
    test('supports explicit promptPath override', async () => {
        const dir = await createTempDir('memo-prompt-test-')
        const promptPath = join(dir, 'custom-prompt.md')
        await writeFile(promptPath, 'cwd={{pwd}}', 'utf-8')

        const prompt = await loadSystemPrompt({
            cwd: '/tmp/project-root',
            includeSkills: false,
            memoHome: dir,
            promptPath,
        })

        expect(prompt).toBe('cwd=/tmp/project-root')
    })

    test('reads prompt from MEMO_SYSTEM_PROMPT_PATH when provided', async () => {
        const dir = await createTempDir('memo-prompt-env-test-')
        const promptPath = join(dir, 'env-prompt.md')
        await writeFile(promptPath, 'from-env', 'utf-8')
        process.env.MEMO_SYSTEM_PROMPT_PATH = promptPath

        const prompt = await loadSystemPrompt({
            cwd: dir,
            includeSkills: false,
            memoHome: dir,
        })

        expect(prompt).toBe('from-env')
    })

    test('injects SOUL.md into placeholder when template includes soul_section', async () => {
        const dir = await createTempDir('memo-prompt-soul-placeholder-')
        const promptPath = join(dir, 'prompt.md')
        const soulPath = join(dir, 'SOUL.md')
        await writeFile(promptPath, 'head\n{{soul_section}}\ntail', 'utf-8')
        await writeFile(soulPath, '# Soul\n\n- calmer tone\n', 'utf-8')

        const prompt = await loadSystemPrompt({
            cwd: dir,
            includeSkills: false,
            memoHome: dir,
            promptPath,
        })

        expect(prompt).toContain('## User Personality Context (SOUL.md)')
        expect(prompt).toContain(`Loaded from: ${soulPath}`)
        expect(prompt).toContain('- calmer tone')
        expect(prompt.indexOf('## User Personality Context (SOUL.md)')).toBeGreaterThan(prompt.indexOf('head'))
        expect(prompt.indexOf('tail')).toBeGreaterThan(prompt.indexOf('## User Personality Context (SOUL.md)'))
    })

    test('falls back to append SOUL.md when template has no placeholder', async () => {
        const dir = await createTempDir('memo-prompt-soul-fallback-')
        const promptPath = join(dir, 'prompt.md')
        const soulPath = join(dir, 'SOUL.md')
        await writeFile(promptPath, 'custom-template', 'utf-8')
        await writeFile(soulPath, 'prefers short replies', 'utf-8')

        const prompt = await loadSystemPrompt({
            cwd: dir,
            includeSkills: false,
            memoHome: dir,
            promptPath,
        })

        expect(prompt.startsWith('custom-template')).toBe(true)
        expect(prompt).toContain('## User Personality Context (SOUL.md)')
        expect(prompt).toContain(`Loaded from: ${soulPath}`)
        expect(prompt).toContain('prefers short replies')
    })

    test('does not inject SOUL section when SOUL.md is missing or empty', async () => {
        const missingDir = await createTempDir('memo-prompt-soul-missing-')
        const promptPath = join(missingDir, 'prompt.md')
        await writeFile(promptPath, 'base {{soul_section}} end', 'utf-8')

        const promptWithoutSoul = await loadSystemPrompt({
            cwd: missingDir,
            includeSkills: false,
            memoHome: missingDir,
            promptPath,
        })
        expect(promptWithoutSoul).toBe('base  end')

        const emptyDir = await createTempDir('memo-prompt-soul-empty-')
        const emptyPromptPath = join(emptyDir, 'prompt.md')
        await writeFile(emptyPromptPath, 'base {{soul_section}} end', 'utf-8')
        await writeFile(join(emptyDir, 'SOUL.md'), ' \n\t\n', 'utf-8')
        const promptWithEmptySoul = await loadSystemPrompt({
            cwd: emptyDir,
            includeSkills: false,
            memoHome: emptyDir,
            promptPath: emptyPromptPath,
        })
        expect(promptWithEmptySoul).toBe('base  end')
    })
})
