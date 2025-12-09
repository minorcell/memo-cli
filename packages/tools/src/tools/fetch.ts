import { z } from 'zod'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

const FETCH_INPUT_SCHEMA = z
    .object({
        url: z.string().min(1),
    })
    .strict()

type FetchInput = z.infer<typeof FETCH_INPUT_SCHEMA>

/**
 * 发起简单的 HTTP GET 请求，返回状态码、正文长度与正文内容。
 */
export const fetchTool: McpTool<FetchInput> = {
    name: 'fetch',
    description: 'HTTP GET 请求，返回状态码与正文',
    inputSchema: FETCH_INPUT_SCHEMA,
    execute: async (input) => {
        try {
            const res = await globalThis.fetch(input.url)
            const body = await res.text()
            return textResult(`status=${res.status} length=${body.length} body="${body}"`)
        } catch (err) {
            return textResult(`请求失败: ${(err as Error).message}`, true)
        }
    },
}
