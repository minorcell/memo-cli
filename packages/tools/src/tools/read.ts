import { z } from 'zod'
import { normalizePath } from '@memo/tools/tools/helpers'
import type { McpTool } from './types'
import { textResult } from '@memo/tools/tools/mcp'

const READ_INPUT_SCHEMA = z
    .object({
        file_path: z.string().min(1),
        offset: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
    })
    .strict()

type ReadInput = z.infer<typeof READ_INPUT_SCHEMA>

export const readTool: McpTool<ReadInput> = {
    name: 'read',
    description: '读取指定文件内容，可按 offset/limit 截取并附带行号',
    inputSchema: READ_INPUT_SCHEMA,
    execute: async (input) => {
        const path = normalizePath(input.file_path)
        const offset = input.offset ?? 1
        const limit = input.limit ?? Number.MAX_SAFE_INTEGER

        try {
            const file = Bun.file(path)
            if (!(await file.exists())) {
                return textResult(`文件不存在: ${path}`, true)
            }

            const content = await file.text()
            const lines = content.split(/\r?\n/)
            const startIdx = Math.max(0, offset - 1)
            const endIdx = Math.min(lines.length, startIdx + limit)
            const sliced = lines.slice(startIdx, endIdx)
            const withNumbers = sliced.map((line, i) => `${startIdx + i + 1}: ${line}`).join('\n')
            return textResult(withNumbers)
        } catch (err) {
            return textResult(`读取失败: ${(err as Error).message}`, true)
        }
    },
}
