import { z } from 'zod'
import { normalizePath } from '@memo/tools/tools/helpers'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

type OutputMode = 'content' | 'files_with_matches' | 'count'

const GREP_INPUT_SCHEMA = z
    .object({
        pattern: z.string().min(1),
        path: z.string().optional(),
        output_mode: z.enum(['content', 'files_with_matches', 'count']).optional(),
        glob: z.string().optional(),
        '-i': z.boolean().optional(),
        '-A': z.number().int().nonnegative().optional(),
        '-B': z.number().int().nonnegative().optional(),
        '-C': z.number().int().nonnegative().optional(),
    })
    .strict()

type GrepInput = z.infer<typeof GREP_INPUT_SCHEMA>

/**
 * 基于 ripgrep 查找文本，支持内容/文件列表/计数三种输出。
 */
export const grepTool: McpTool<GrepInput> = {
    name: 'grep',
    description: '基于 ripgrep 查找文本，支持输出匹配内容、文件列表或计数',
    inputSchema: GREP_INPUT_SCHEMA,
    execute: async (input) => {
        const rgPath = Bun.which('rg')
        if (!rgPath) {
            return textResult('rg 未安装或不在 PATH', true)
        }

        const basePath = input.path ? normalizePath(input.path) : process.cwd()
        const args = ['rg', '--color', 'never']
        const mode: OutputMode = input.output_mode ?? 'content'

        if (mode === 'files_with_matches') {
            args.push('-l')
        } else if (mode === 'count') {
            args.push('-c')
        } else {
            args.push('--line-number', '--no-heading')
        }

        if (input['-i']) args.push('-i')
        if (input.glob) args.push('--glob', input.glob)
        if (input['-A'] !== undefined) args.push('-A', String(input['-A']))
        if (input['-B'] !== undefined) args.push('-B', String(input['-B']))
        if (input['-C'] !== undefined) args.push('-C', String(input['-C']))

        args.push(input.pattern, basePath)

        try {
            const proc = Bun.spawn(args, {
                stdout: 'pipe',
                stderr: 'pipe',
            })
            const [stdout, stderr] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ])
            const exitCode = await proc.exited

            if (exitCode === 2) {
                return textResult(`grep 失败(exit=2): ${stderr || stdout}`, true)
            }

            if (exitCode === 1 && !stdout.trim()) {
                return textResult('未找到匹配')
            }

            return textResult(stdout || stderr || `命令完成 exit=${exitCode}`)
        } catch (err) {
            return textResult(`grep 执行失败: ${(err as Error).message}`, true)
        }
    },
}
