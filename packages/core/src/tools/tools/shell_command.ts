import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import { startExecSession } from '@memo/core/tools/tools/exec_runtime'

const SHELL_COMMAND_INPUT_SCHEMA = z
    .object({
        command: z.string().min(1, 'command cannot be empty'),
        workdir: z.string().optional(),
        login: z.boolean().optional(),
        timeout_ms: z.number().int().positive().optional(),
        sandbox_permissions: z.enum(['use_default', 'require_escalated']).optional(),
        justification: z.string().optional(),
        prefix_rule: z.array(z.string().min(1)).optional(),
    })
    .strict()

export const shellCommandTool = tool({
    description: 'Runs a shell command and returns its output. Always set workdir when possible.',
    inputSchema: SHELL_COMMAND_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: true, isMutating: true } },

    execute: async ({ command, workdir, login, timeout_ms }) => {
        try {
            const content = await startExecSession({
                cmd: command,
                workdir,
                login,
                yield_time_ms: timeout_ms,
                execution_timeout_ms: timeout_ms,
                source_tool: 'shell_command',
            })
            return textResult(content)
        } catch (err) {
            return textResult(`shell_command failed: ${(err as Error).message}`, true)
        }
    },
})
