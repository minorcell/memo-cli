import type { CallToolResult } from '@modelcontextprotocol/sdk/types'

/** 快捷构造文本型 CallToolResult。 */
export function textResult(text: string, isError = false): CallToolResult {
    return { content: [{ type: 'text', text }], isError }
}

/** 将 CallToolResult 的文本内容拍平成字符串，便于 observation。 */
export function flattenText(result: CallToolResult): string {
    const texts =
        result.content?.flatMap((item) => {
            if (item.type === 'text') return [item.text]
            return []
        }) ?? []
    return texts.join('\n')
}
