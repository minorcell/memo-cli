import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

const MEMORY_INPUT_SCHEMA = z
    .object({
        note: z.string().min(1, 'note 不能为空').max(32, 'note 需不超过 32 字符'),
    })
    .strict()

type MemoryInput = z.infer<typeof MEMORY_INPUT_SCHEMA>

function resolveMemoryPath() {
    const base = process.env.MEMO_HOME?.trim() || join(homedir(), '.memo')
    return join(base, 'memory.md')
}

function sanitizeNote(note: string) {
    return note
        .replace(/\r?\n/g, ' ') // 折行防止格式破坏
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * 将简短记忆追加到 ~/.memo/memory.md，供后续会话注入系统提示词。
 */
export const memoryTool: McpTool<MemoryInput> = {
    name: 'memory',
    description: '追加一条简短的用户记忆（身份/偏好等），供后续对话使用',
    inputSchema: MEMORY_INPUT_SCHEMA,
    execute: async (input) => {
        const note = sanitizeNote(input.note)
        if (!note) {
            return textResult('note 不能为空', true)
        }
        const memoryPath = resolveMemoryPath()
        const dir = dirname(memoryPath)
        try {
            await mkdir(dir, { recursive: true })
            const line = `- ${new Date().toISOString()} ${note}\n`

            try {
                const file = Bun.file(memoryPath)
                const existing = (await file.exists()) ? await file.text() : ''
                const lines = existing.split(/\r?\n/).filter((l) => l.trim().startsWith('- '))
                lines.push(line.trim())
                const pruned = lines.slice(Math.max(0, lines.length - 50))
                const finalContent = pruned.join('\n') + '\n'
                await Bun.write(memoryPath, finalContent)
            } catch (err) {
                console.warn(`memory 维护失败: ${(err as Error).message}`)
            }

            return textResult(`已追加到 memory: ${memoryPath}`)
        } catch (err) {
            return textResult(`写入 memory 失败: ${(err as Error).message}`, true)
        }
    },
}
