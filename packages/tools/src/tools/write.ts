import { z } from 'zod'
import { normalizePath } from '@memo/tools/tools/helpers'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

const WRITE_INPUT_SCHEMA = z
    .object({
        file_path: z.string().min(1),
        content: z.any(),
    })
    .strict()

type WriteInput = z.infer<typeof WRITE_INPUT_SCHEMA>

/** 覆盖写入文件内容，必要时递归创建父目录。 */
export const writeTool: McpTool<WriteInput> = {
    name: 'write',
    description: '创建或覆盖文件，传入 file_path 与 content',
    inputSchema: WRITE_INPUT_SCHEMA,
    execute: async (input) => {
        const path = normalizePath(input.file_path)
        const content = String(input.content ?? '')
        try {
            await Bun.write(path, content)
            return textResult(`已写入 ${path} (overwrite, length=${content.length})`)
        } catch (err) {
            return textResult(`写入失败: ${(err as Error).message}`, true)
        }
    },
}
