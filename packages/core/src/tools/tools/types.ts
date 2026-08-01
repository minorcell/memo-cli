import type { CallToolResult } from '@modelcontextprotocol/sdk/types'
import type { NativeTool } from '@memo/core/tools/router/types'
import type { ZodTypeAny } from 'zod'

// Tool-related type declarations

/** Tool name enum, used as tool field in Agent action. */
/** Tool name (string), supports built-in and dynamically extended tools. */
export type ToolName = string

/** Unified tool definition (consistent with router layer Tool format). */
export type McpTool = NativeTool

/** Define tool based on zod schema, outputs unified MCP/Router tool format. */
export function defineMcpTool<Input>(tool: {
    name: ToolName
    description: string
    inputSchema: ZodTypeAny
    supportsParallelToolCalls?: boolean
    isMutating?: boolean
    execute: (input: Input) => Promise<CallToolResult>
}): McpTool {
    const { inputSchema, execute, ...rest } = tool
    const jsonSchema = (inputSchema as any).toJSONSchema?.()
    const { $schema: _$schema, ...inputSchemaJson } =
        (jsonSchema as Record<string, unknown> & { $schema?: string }) ?? {}

    return {
        ...rest,
        source: 'native',
        inputSchema: inputSchemaJson,
        validateInput: (input: unknown) => {
            const parsed = inputSchema.safeParse(input)
            if (!parsed.success) {
                const detail = parsed.error.issues[0]?.message ?? 'invalid input'
                return { ok: false, error: `${tool.name} invalid input: ${detail}` }
            }
            return { ok: true, data: parsed.data }
        },
        execute: execute as (input: unknown) => Promise<CallToolResult>,
    }
}
