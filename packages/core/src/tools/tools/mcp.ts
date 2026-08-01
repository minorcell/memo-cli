import type { CallToolResult } from '@modelcontextprotocol/sdk/types'

/** Quick constructor for text-based CallToolResult. */
export function textResult(text: string, isError = false): CallToolResult {
    return { content: [{ type: 'text', text }], isError }
}

/** Flatten CallToolResult text content to string for observation. */
export function flattenText(result: CallToolResult): string {
    const texts =
        result.content?.flatMap((item) => {
            if (item.type === 'text') return [item.text]
            return []
        }) ?? []
    return texts.join('\n')
}
