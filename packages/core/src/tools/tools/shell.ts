import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import { startExecSession } from '@memo/core/tools/tools/exec_runtime'

const SHELL_INPUT_SCHEMA = z
    .object({
        command: z.array(z.string().min(1)).min(1, 'command cannot be empty'),
        workdir: z.string().optional(),
        timeout_ms: z.number().int().positive().optional(),
        sandbox_permissions: z.enum(['use_default', 'require_escalated']).optional(),
        justification: z.string().optional(),
        prefix_rule: z.array(z.string().min(1)).optional(),
    })
    .strict()

const SAFE_SHELL_ARG = /^[A-Za-z0-9_./:@%+-]+$/

function shellQuote(part: string) {
    if (part.length === 0) return "''"
    if (SAFE_SHELL_ARG.test(part)) return part
    return `'${part.replace(/'/g, `'"'"'`)}'`
}

function shellJoin(argv: string[]) {
    return argv.map((part) => shellQuote(part)).join(' ')
}

export const shellTool = tool({
    description: 'Runs a shell command (argv form) and returns output.',
    inputSchema: SHELL_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: true, isMutating: true } },

    execute: async ({ command, workdir, timeout_ms }) => {
        try {
            const content = await startExecSession({
                cmd: shellJoin(command),
                workdir,
                login: false,
                yield_time_ms: timeout_ms,
                execution_timeout_ms: timeout_ms,
                source_tool: 'shell',
            })
            return textResult(content)
        } catch (err) {
            return textResult(`shell failed: ${(err as Error).message}`, true)
        }
    },
})
