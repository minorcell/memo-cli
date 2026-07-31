import { z } from 'zod'
import { defineMcpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'
import { applyFileEdits, validatePath } from '@memo/tools/tools/filesystem/lib'
import { resolveAllowedDirectories } from '@memo/tools/tools/filesystem/roots'

const EDIT_FILE_INPUT_SCHEMA = z
    .object({
        path: z.string().min(1),
        edits: z
            .array(
                z
                    .object({
                        oldText: z.string(),
                        newText: z.string(),
                    })
                    .strict(),
            )
            .min(1),
        dryRun: z.boolean().optional().default(false),
    })
    .strict()

type EditFileInput = z.infer<typeof EDIT_FILE_INPUT_SCHEMA>

export const editFileTool = defineMcpTool<EditFileInput>({
    name: 'edit_file',
    description: 'Apply ordered edit operations to a text file and return a unified diff (dryRun previews only).',
    inputSchema: EDIT_FILE_INPUT_SCHEMA,
    supportsParallelToolCalls: false,
    isMutating: true,
    execute: async (input) => {
        try {
            const allowedDirectories = await resolveAllowedDirectories()
            const validPath = await validatePath(input.path, allowedDirectories)
            const result = await applyFileEdits(validPath, input.edits, input.dryRun)
            return textResult(result)
        } catch (err) {
            return textResult(`edit_file failed: ${(err as Error).message}`, true)
        }
    },
})
