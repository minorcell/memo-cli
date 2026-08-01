import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'

const GET_MEMORY_INPUT_SCHEMA = z
    .object({
        memory_id: z.string().min(1),
    })
    .strict()

function resolveMemoryPath() {
    const base = process.env.MEMO_HOME?.trim() || join(homedir(), '.memo')
    return join(base, 'Agents.md')
}

export const getMemoryTool = tool({
    description: 'Loads the stored memory payload for a memory_id.',
    inputSchema: GET_MEMORY_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: true, isMutating: false } },

    execute: async ({ memory_id }) => {
        try {
            const memoryPath = resolveMemoryPath()
            const content = await readFile(memoryPath, 'utf8')
            return textResult(
                JSON.stringify(
                    {
                        memory_id,
                        memory_summary: content,
                    },
                    null,
                    2,
                ),
            )
        } catch {
            return textResult(`memory not found for memory_id=${memory_id}`, true)
        }
    },
})
