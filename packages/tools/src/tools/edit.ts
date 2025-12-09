import { z } from 'zod'
import { normalizePath } from '@memo/tools/tools/helpers'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

const EDIT_INPUT_SCHEMA = z
    .object({
        file_path: z.string().min(1),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
    })
    .strict()

type EditInput = z.infer<typeof EDIT_INPUT_SCHEMA>

/**
 * 根据入参在目标文件中替换文本，支持单次或全局替换。
 * 返回替换数量及文件路径，若未找到或未变更会返回提示语。
 */
export const editTool: McpTool<EditInput> = {
    name: 'edit',
    description: '在文件中替换文本，支持 replace_all',
    inputSchema: EDIT_INPUT_SCHEMA,
    execute: async (input) => {
        const path = normalizePath(input.file_path)
        const replaceAll = input.replace_all ?? false

        try {
            const file = Bun.file(path)
            if (!(await file.exists())) {
                return textResult(`文件不存在: ${path}`, true)
            }
            const original = await file.text()

            if (!original.includes(input.old_string)) {
                return textResult('未找到待替换文本', true)
            }

            let replaced: string
            let count = 0
            if (replaceAll) {
                const parts = original.split(input.old_string)
                count = parts.length - 1
                replaced = parts.join(input.new_string)
            } else {
                replaced = original.replace(input.old_string, input.new_string)
                count = 1
            }

            if (replaced === original) {
                return textResult('未检测到内容变化')
            }

            await Bun.write(path, replaced)
            return textResult(`替换完成: file=${path} count=${count}`)
        } catch (err) {
            return textResult(`edit 失败: ${(err as Error).message}`, true)
        }
    },
}
