import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import { startExecSession } from '@memo/core/tools/tools/exec_runtime'

const EXEC_COMMAND_INPUT_SCHEMA = z
    .object({
        cmd: z.string().min(1, 'cmd cannot be empty'),
        workdir: z.string().optional(),
        shell: z.string().optional(),
        login: z.boolean().optional(),
        tty: z.boolean().optional(),
        yield_time_ms: z.number().int().nonnegative().optional(),
        max_output_tokens: z.number().int().positive().optional(),
        sandbox_permissions: z.enum(['use_default', 'require_escalated']).optional(),
        justification: z.string().optional(),
        prefix_rule: z.array(z.string().min(1)).optional(),
    })
    .strict()

export const execCommandTool = tool({
    description:
        'Runs a command in a PTY-like managed session, returning output or a session ID for ongoing interaction.',
    inputSchema: EXEC_COMMAND_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: true, isMutating: true } },

    execute: async (input) => {
        try {
            const content = await startExecSession({
                ...input,
                source_tool: 'exec_command',
            })
            return textResult(content)
        } catch (err) {
            return textResult(`exec_command failed: ${(err as Error).message}`, true)
        }
    },
})
