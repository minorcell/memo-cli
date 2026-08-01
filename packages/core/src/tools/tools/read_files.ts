import { z } from 'zod'
import { defineMcpTool } from '@memo/core/tools/tools/types'
import { textResult } from '@memo/core/tools/tools/mcp'
import { readFileContent, validatePath } from '@memo/core/tools/tools/filesystem/lib'
import { resolveAllowedDirectories } from '@memo/core/tools/tools/filesystem/roots'

const READ_FILES_INPUT_SCHEMA = z
    .object({
        paths: z.array(z.string().min(1)).min(1),
    })
    .strict()

type ReadFilesInput = z.infer<typeof READ_FILES_INPUT_SCHEMA>

export const readFilesTool = defineMcpTool<ReadFilesInput>({
    name: 'read_files',
    description:
        'Read multiple text files in one call. Per-file failures are returned inline without aborting the batch.',
    inputSchema: READ_FILES_INPUT_SCHEMA,
    supportsParallelToolCalls: true,
    isMutating: false,
    execute: async (input) => {
        try {
            const allowedDirectories = await resolveAllowedDirectories()
            const results: string[] = []
            for (const filePath of input.paths) {
                try {
                    const validPath = await validatePath(filePath, allowedDirectories)
                    const content = await readFileContent(validPath)
                    results.push(`${filePath}:\n${content}\n`)
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    results.push(`${filePath}: Error - ${message}`)
                }
            }

            return textResult(results.join('\n---\n'))
        } catch (err) {
            return textResult(`read_files failed: ${(err as Error).message}`, true)
        }
    },
})
