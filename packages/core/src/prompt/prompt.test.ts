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
})
