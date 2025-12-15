import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'
import { unlink } from 'node:fs/promises'

const BUN_INPUT_SCHEMA = z
    .object({
        code: z.string().min(1, 'code cannot be empty'),
    })
    .strict()

type BunInput = z.infer<typeof BUN_INPUT_SCHEMA>

/**
 * 通过将代码写入临时文件并运行来执行任意 Bun (JS/TS) 代码。
 * 这充当了 Agent 的 "Code Interpreter"。
 */
export const runBunTool: McpTool<BunInput> = {
    name: 'run_bun',
    description:
        '在临时文件中运行 Bun (JS/TS) 代码。支持 top-level await。使用 console.log 输出结果。',
    inputSchema: BUN_INPUT_SCHEMA,
    execute: async ({ code }) => {
        // 创建临时文件路径
        const tmpDir = process.env.TMPDIR || '/tmp'
        const tmpFilePath = `${tmpDir}/memo-run-bun-${randomUUID()}.ts`

        try {
            // 将代码写入临时文件
            await Bun.write(tmpFilePath, code)

            // 启动 Bun 运行文件
            const proc = Bun.spawn(['bun', 'run', tmpFilePath], {
                stdout: 'pipe',
                stderr: 'pipe',
                env: { ...process.env, FORCE_COLOR: '0' }, // 禁用颜色以便更清晰地解析
            })

            const [stdout, stderr] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ])
            const exitCode = await proc.exited

            return textResult(`exit=${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
        } catch (err) {
            return textResult(`run_bun failed: ${(err as Error).message}`, true)
        } finally {
            // 清理：尝试删除临时文件
            try {
                const file = Bun.file(tmpFilePath)
                if (await file.exists()) {
                    await unlink(tmpFilePath)
                }
            } catch {
                // 忽略清理错误
            }
        }
    },
}
