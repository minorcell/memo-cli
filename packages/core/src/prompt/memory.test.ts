/** @file 运行时上下文注入系统提示词的回归测试。 */
import assert from 'node:assert'
import { join } from 'node:path'
import { tmpdir, userInfo } from 'node:os'
import { describe, test, beforeAll, afterAll } from 'vitest'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { createAgentSession, createTokenCounter, type ChatMessage } from '@memo/core'
import { loadSystemPrompt } from '@memo/core/prompt/prompt'
import { emptyUsage } from '@memo/core/session/session_runtime_helpers'

/** System messages carry string content; parts arrays (assistant/tool) are not expected here. */
function systemPromptOf(history: ChatMessage[]): string {
    const content = history[0]?.content
    return typeof content === 'string' ? content : ''
}

let tempHome: string
let prevMemoHome: string | undefined

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
    return dir
}

async function removeDir(dir: string) {
    await rm(dir, { recursive: true, force: true })
}

beforeAll(async () => {
    tempHome = await makeTempDir('memo-core-memory')
    prevMemoHome = process.env.MEMO_HOME
    process.env.MEMO_HOME = tempHome
})

afterAll(async () => {
    if (prevMemoHome === undefined) {
        delete process.env.MEMO_HOME
    } else {
        process.env.MEMO_HOME = prevMemoHome
    }
    await removeDir(tempHome)
})

describe('runtime prompt injection', () => {
    test('does not auto-inject Agents.md memory into system prompt', async () => {
        const memoryPath = join(tempHome, 'Agents.md')
        await writeFile(memoryPath, '## Memo Added Memories\n\n- 用户偏好：中文回答\n', 'utf-8')

        const session = await createAgentSession(
            {
                callLLM: async () => ({
                    text: 'ok',
                    toolCalls: [],
                    usage: emptyUsage(),
                    finishReason: 'stop',
                }),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
            },
            { mode: 'interactive' },
        )
        try {
            const systemPrompt = systemPromptOf(session.history)
            assert.ok(!systemPrompt.includes('Long-Term Memory'))
            assert.ok(!systemPrompt.includes('用户偏好：中文回答'))
        } finally {
            await session.close()
        }
    })

    test('injects runtime context into system prompt', async () => {
        const session = await createAgentSession(
            {
                callLLM: async () => ({
                    text: 'ok',
                    toolCalls: [],
                    usage: emptyUsage(),
                    finishReason: 'stop',
                }),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
            },
            { mode: 'interactive' },
        )
        try {
            const systemPrompt = systemPromptOf(session.history)
            assert.ok(systemPrompt.includes(process.cwd()), 'system prompt should include pwd')
            assert.ok(systemPrompt.includes(userInfo().username), 'system prompt should include username')
            assert.match(systemPrompt, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/, 'system prompt should include ISO date')
            assert.ok(!systemPrompt.includes('{{date}}'), 'template variables should be rendered')
        } finally {
            await session.close()
        }
    })

    test('appends startup root AGENTS.md into system prompt', async () => {
        const projectRoot = await makeTempDir('memo-core-project')
        const agentsPath = join(projectRoot, 'AGENTS.md')
        const marker = 'memo-test-guideline-keep-shell-safe'
        await writeFile(agentsPath, `# Project Rules\n\n- ${marker}\n`, 'utf-8')

        const session = await createAgentSession(
            {
                callLLM: async () => ({
                    text: 'ok',
                    toolCalls: [],
                    usage: emptyUsage(),
                    finishReason: 'stop',
                }),
                loadPrompt: () => loadSystemPrompt({ cwd: projectRoot }),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
            },
            { mode: 'interactive' },
        )

        try {
            const systemPrompt = systemPromptOf(session.history)
            assert.ok(systemPrompt.includes('Project AGENTS.md (Startup Root)'))
            assert.ok(systemPrompt.includes(agentsPath))
            assert.ok(systemPrompt.includes(marker))
        } finally {
            await session.close()
            await removeDir(projectRoot)
        }
    })

    test('injects SOUL.md before startup root AGENTS.md in system prompt', async () => {
        const projectRoot = await makeTempDir('memo-core-soul-order-project')
        const soulPath = join(tempHome, 'SOUL.md')
        const agentsPath = join(projectRoot, 'AGENTS.md')
        const soulMarker = 'memo-test-soul-style-preference'
        const agentsMarker = 'memo-test-agents-constraint'
        await writeFile(soulPath, `# Soul\n\n- ${soulMarker}\n`, 'utf-8')
        await writeFile(agentsPath, `# Project Rules\n\n- ${agentsMarker}\n`, 'utf-8')

        const session = await createAgentSession(
            {
                callLLM: async () => ({
                    text: 'ok',
                    toolCalls: [],
                    usage: emptyUsage(),
                    finishReason: 'stop',
                }),
                loadPrompt: () => loadSystemPrompt({ cwd: projectRoot, memoHome: tempHome }),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
            },
            { mode: 'interactive' },
        )

        try {
            const systemPrompt = systemPromptOf(session.history)
            assert.ok(systemPrompt.includes('## User Personality Context (SOUL.md)'))
            assert.ok(systemPrompt.includes(soulPath))
            assert.ok(systemPrompt.includes(soulMarker))
            assert.ok(systemPrompt.includes(agentsMarker))
            const soulIndex = systemPrompt.indexOf('## User Personality Context (SOUL.md)')
            const agentsIndex = systemPrompt.indexOf('## Project AGENTS.md (Startup Root)')
            assert.ok(soulIndex >= 0)
            assert.ok(agentsIndex > soulIndex)
        } finally {
            await session.close()
            await removeDir(projectRoot)
            await rm(soulPath, { force: true })
        }
    })

    test('appends discovered skills into system prompt', async () => {
        const projectRoot = await makeTempDir('memo-core-skills-project')
        const skillsRoot = join(projectRoot, '.codex', 'skills')
        const skillDir = join(skillsRoot, 'doc-writing')
        const skillPath = join(skillDir, 'SKILL.md')
        const marker = 'memo-test-skill-doc-writing'
        await mkdir(skillDir, { recursive: true })
        await writeFile(
            skillPath,
            `---
name: doc-writing
description: ${marker}
---
# Doc Writing
`,
            'utf-8',
        )

        const session = await createAgentSession(
            {
                callLLM: async () => ({
                    text: 'ok',
                    toolCalls: [],
                    usage: emptyUsage(),
                    finishReason: 'stop',
                }),
                loadPrompt: () =>
                    loadSystemPrompt({
                        cwd: projectRoot,
                        skillRoots: [skillsRoot],
                        homeDir: projectRoot,
                        memoHome: join(projectRoot, '.memo'),
                    }),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
            },
            { mode: 'interactive' },
        )

        try {
            const systemPrompt = systemPromptOf(session.history)
            assert.ok(systemPrompt.includes('## Skills'))
            assert.ok(systemPrompt.includes('### Available skills'))
            assert.ok(systemPrompt.includes(`- doc-writing: ${marker} (file: ${skillPath})`))
        } finally {
            await session.close()
            await removeDir(projectRoot)
        }
    })

    test('injects only active skills when activeSkillPaths is provided', async () => {
        const projectRoot = await makeTempDir('memo-core-skills-active-filter')
        const skillsRoot = join(projectRoot, '.codex', 'skills')
        const enabledDir = join(skillsRoot, 'enabled-skill')
        const disabledDir = join(skillsRoot, 'disabled-skill')
        const enabledPath = join(enabledDir, 'SKILL.md')
        const disabledPath = join(disabledDir, 'SKILL.md')
        await mkdir(enabledDir, { recursive: true })
        await mkdir(disabledDir, { recursive: true })

        await writeFile(
            enabledPath,
            `---
name: enabled-skill
description: enabled marker
---
# enabled
`,
            'utf-8',
        )
        await writeFile(
            disabledPath,
            `---
name: disabled-skill
description: disabled marker
---
# disabled
`,
            'utf-8',
        )

        const session = await createAgentSession(
            {
                callLLM: async () => ({
                    text: 'ok',
                    toolCalls: [],
                    usage: emptyUsage(),
                    finishReason: 'stop',
                }),
                loadPrompt: () =>
                    loadSystemPrompt({
                        cwd: projectRoot,
                        skillRoots: [skillsRoot],
                        homeDir: projectRoot,
                        memoHome: join(projectRoot, '.memo'),
                        activeSkillPaths: [enabledPath],
                    }),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
            },
            { mode: 'interactive' },
        )

        try {
            const systemPrompt = systemPromptOf(session.history)
            assert.ok(systemPrompt.includes('enabled-skill'))
            assert.ok(!systemPrompt.includes('disabled-skill'))
        } finally {
            await session.close()
            await removeDir(projectRoot)
        }
    })

    test('ignores invalid skills without required frontmatter fields', async () => {
        const projectRoot = await makeTempDir('memo-core-skills-invalid')
        const skillsRoot = join(projectRoot, '.codex', 'skills')
        const skillDir = join(skillsRoot, 'broken-skill')
        const skillPath = join(skillDir, 'SKILL.md')
        await mkdir(skillDir, { recursive: true })
        await writeFile(
            skillPath,
            `---
name: broken-skill
---
# Missing description in frontmatter
`,
            'utf-8',
        )

        const session = await createAgentSession(
            {
                callLLM: async () => ({
                    text: 'ok',
                    toolCalls: [],
                    usage: emptyUsage(),
                    finishReason: 'stop',
                }),
                loadPrompt: () =>
                    loadSystemPrompt({
                        cwd: projectRoot,
                        skillRoots: [skillsRoot],
                        homeDir: projectRoot,
                        memoHome: join(projectRoot, '.memo'),
                    }),
                historySinks: [],
                tokenCounter: createTokenCounter('cl100k_base'),
            },
            { mode: 'interactive' },
        )

        try {
            const systemPrompt = systemPromptOf(session.history)
            assert.ok(!systemPrompt.includes('## Skills'))
            assert.ok(!systemPrompt.includes('broken-skill'))
        } finally {
            await session.close()
            await removeDir(projectRoot)
        }
    })
})
