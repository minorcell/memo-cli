import { z } from 'zod'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

const BASH_INPUT_SCHEMA = z
    .object({
        command: z.string().min(1, 'command 不能为空'),
    })
    .strict()

type BashInput = z.infer<typeof BASH_INPUT_SCHEMA>

/**
 * 执行任意 bash 命令，将 exit/stdout/stderr 拼接返回。
 * 主要用于调试/脚本执行，注意命令安全性需由上层控制。
 */
export const bashTool: McpTool<BashInput> = {
    name: 'bash',
    description: '在 shell 中执行命令，返回 exit/stdout/stderr',
    inputSchema: BASH_INPUT_SCHEMA,
    execute: async ({ command }) => {
        const cmd = command.trim()
        if (!cmd) return textResult('bash 需要要执行的命令', true)

        try {
            const proc = Bun.spawn(['bash', '-lc', cmd], {
                stdout: 'pipe',
                stderr: 'pipe',
                env: process.env,
            })

            const [stdout, stderr] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ])
            const exitCode = await proc.exited

            return textResult(`exit=${exitCode} stdout="${stdout}" stderr="${stderr}"`)
        } catch (err) {
            return textResult(`bash 执行失败: ${(err as Error).message}`, true)
        }
    },
}
