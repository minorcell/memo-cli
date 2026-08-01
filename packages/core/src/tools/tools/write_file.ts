import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import { validatePath, writeFileContent } from '@memo/core/tools/tools/filesystem/lib'
import { resolveAllowedDirectories } from '@memo/core/tools/tools/filesystem/roots'

const WRITE_FILE_INPUT_SCHEMA = z
    .object({
        path: z.string().min(1),
        content: z.string(),
    })
    .strict()

export const writeFileTool = tool({
    description: 'Create or overwrite a file with UTF-8 content using atomic replace semantics.',
    inputSchema: WRITE_FILE_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: false, isMutating: true } },

    execute: async (input) => {
        try {
            const allowedDirectories = await resolveAllowedDirectories()
            const validPath = await validatePath(input.path, allowedDirectories)
            await writeFileContent(validPath, input.content)
            return textResult(`Successfully wrote to ${input.path}`)
        } catch (err) {
            return textResult(`write_file failed: ${(err as Error).message}`, true)
        }
    },
})
