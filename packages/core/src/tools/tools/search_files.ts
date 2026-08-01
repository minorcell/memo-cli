import { z } from 'zod'
import { defineMcpTool } from '@memo/core/tools/tools/types'
import { textResult } from '@memo/core/tools/tools/mcp'
import { searchFilesWithValidation, validatePath } from '@memo/core/tools/tools/filesystem/lib'
import { resolveAllowedDirectories } from '@memo/core/tools/tools/filesystem/roots'

const SEARCH_FILES_INPUT_SCHEMA = z
    .object({
        path: z.string().min(1),
        pattern: z.string().min(1),
        excludePatterns: z.array(z.string()).optional().default([]),
    })
    .strict()

type SearchFilesInput = z.infer<typeof SEARCH_FILES_INPUT_SCHEMA>

export const searchFilesTool = defineMcpTool<SearchFilesInput>({
    name: 'search_files',
    description: 'Recursively search files and directories by glob pattern within allowed directories.',
    inputSchema: SEARCH_FILES_INPUT_SCHEMA,
    supportsParallelToolCalls: true,
    isMutating: false,
    execute: async (input) => {
        try {
            const allowedDirectories = await resolveAllowedDirectories()
            const validPath = await validatePath(input.path, allowedDirectories)
            const results = await searchFilesWithValidation(validPath, input.pattern, allowedDirectories, {
                excludePatterns: input.excludePatterns,
            })
            return textResult(results.length > 0 ? results.join('\n') : 'No matches found')
        } catch (err) {
            return textResult(`search_files failed: ${(err as Error).message}`, true)
        }
    },
})
