import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import { applyFileEdits, validatePath } from '@memo/core/tools/tools/filesystem/lib'
import { resolveAllowedDirectories } from '@memo/core/tools/tools/filesystem/roots'

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

export const editFileTool = tool({
    description: 'Apply ordered edit operations to a text file and return a unified diff (dryRun previews only).',
    inputSchema: EDIT_FILE_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: false, isMutating: true } },

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
