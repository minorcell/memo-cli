import { z } from 'zod'
import { normalizePath } from '@memo/tools/tools/helpers'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

const GLOB_INPUT_SCHEMA = z
    .object({
        pattern: z.string().min(1),
        path: z.string().optional(),
    })
    .strict()

type GlobInput = z.infer<typeof GLOB_INPUT_SCHEMA>

/**
 * 扫描目录下符合 pattern 的文件，返回绝对路径列表。
 * 默认在当前工作目录执行，可通过 path 覆盖。
 */
export const globTool: McpTool<GlobInput> = {
    name: 'glob',
    description: '按 glob 模式匹配文件，返回绝对路径列表',
    inputSchema: GLOB_INPUT_SCHEMA,
    execute: async (input) => {
        const cwd = input.path ? normalizePath(input.path) : process.cwd()
        const globber = new Bun.Glob(input.pattern)
        const matches: string[] = []

        try {
            for await (const file of globber.scan({ cwd })) {
                matches.push(normalizePath(`${cwd}/${file}`))
            }
            return textResult(matches.join('\n') || '未找到匹配文件')
        } catch (err) {
            return textResult(`glob 失败: ${(err as Error).message}`, true)
        }
    },
}
