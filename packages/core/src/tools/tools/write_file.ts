import { z } from 'zod'
import { defineMcpTool } from '@memo/core/tools/tools/types'
import { textResult } from '@memo/core/tools/tools/mcp'
import { validatePath, writeFileContent } from '@memo/core/tools/tools/filesystem/lib'
import { resolveAllowedDirectories } from '@memo/core/tools/tools/filesystem/roots'

const WRITE_FILE_INPUT_SCHEMA = z
    .object({
        path: z.string().min(1),
        content: z.string(),
    })
    .strict()

type WriteFileInput = z.infer<typeof WRITE_FILE_INPUT_SCHEMA>

export const writeFileTool = defineMcpTool<WriteFileInput>({
    name: 'write_file',
    description: 'Create or overwrite a file with UTF-8 content using atomic replace semantics.',
    inputSchema: WRITE_FILE_INPUT_SCHEMA,
    supportsParallelToolCalls: false,
    isMutating: true,
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
