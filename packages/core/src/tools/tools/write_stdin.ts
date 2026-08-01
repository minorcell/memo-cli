import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import { writeExecSession } from '@memo/core/tools/tools/exec_runtime'

const WRITE_STDIN_INPUT_SCHEMA = z
    .object({
        session_id: z.number().int().positive(),
        chars: z.string().optional(),
        yield_time_ms: z.number().int().nonnegative().optional(),
        max_output_tokens: z.number().int().positive().optional(),
    })
    .strict()

export const writeStdinTool = tool({
    description: 'Writes characters to an existing unified exec session and returns recent output.',
    inputSchema: WRITE_STDIN_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: false, isMutating: true } },

    execute: async (input) => {
        try {
            const content = await writeExecSession({
                ...input,
                source_tool: 'write_stdin',
            })
            return textResult(content)
        } catch (err) {
            return textResult(`write_stdin failed: ${(err as Error).message}`, true)
        }
    },
})
