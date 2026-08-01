import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import { headFile, readFileContent, tailFile, validatePath } from '@memo/core/tools/tools/filesystem/lib'
import { resolveAllowedDirectories } from '@memo/core/tools/tools/filesystem/roots'

const READ_TEXT_FILE_INPUT_SCHEMA = z
    .object({
        path: z.string().min(1),
        head: z.number().int().positive().optional(),
        tail: z.number().int().positive().optional(),
    })
    .strict()

export const readTextFileTool = tool({
    description: 'Read the complete file content as text, optionally with head/tail line limits.',
    inputSchema: READ_TEXT_FILE_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: true, isMutating: false } },

    execute: async (input) => {
        if (input.head && input.tail) {
            return textResult('Cannot specify both head and tail parameters simultaneously', true)
        }

        try {
            const allowedDirectories = await resolveAllowedDirectories()
            const validPath = await validatePath(input.path, allowedDirectories)

            let content: string
            if (input.tail) {
                content = await tailFile(validPath, input.tail)
            } else if (input.head) {
                content = await headFile(validPath, input.head)
            } else {
                content = await readFileContent(validPath)
            }

            return textResult(content)
        } catch (err) {
            return textResult(`read_text_file failed: ${(err as Error).message}`, true)
        }
    },
})
