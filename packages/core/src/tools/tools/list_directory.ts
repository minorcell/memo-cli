import fs from 'node:fs/promises'
import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import { validatePath } from '@memo/core/tools/tools/filesystem/lib'
import { resolveAllowedDirectories } from '@memo/core/tools/tools/filesystem/roots'

const LIST_DIRECTORY_INPUT_SCHEMA = z
    .object({
        path: z.string().min(1),
    })
    .strict()

export const listDirectoryTool = tool({
    description: 'List direct children of a directory using [DIR]/[FILE] labels.',
    inputSchema: LIST_DIRECTORY_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: true, isMutating: false } },

    execute: async (input) => {
        try {
            const allowedDirectories = await resolveAllowedDirectories()
            const validPath = await validatePath(input.path, allowedDirectories)
            const entries = await fs.readdir(validPath, { withFileTypes: true })
            const formatted = entries
                .map((entry) => `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`)
                .join('\n')
            return textResult(formatted)
        } catch (err) {
            return textResult(`list_directory failed: ${(err as Error).message}`, true)
        }
    },
})
