import type { ParsedAssistant } from '@memo/core/types'

/**
 * 将模型输出解析为 JSON 结构，提取 action/final 字段。
 * 期望格式：{"thought":"...","action":{"tool":"read","input":{...}}} 或 {"final":"..."}
 */
export function parseAssistant(content: string): ParsedAssistant {
    let parsedJson: unknown
    try {
        parsedJson = JSON.parse(content)
    } catch {
        return {}
    }
    if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) return {}

    const obj = parsedJson as Record<string, unknown>
    const parsed: ParsedAssistant = {}

    const finalText = obj.final
    if (typeof finalText === 'string' && finalText.trim()) {
        parsed.final = finalText.trim()
    }

    const action = obj.action
    if (action && typeof action === 'object' && !Array.isArray(action)) {
        const tool = (action as Record<string, unknown>).tool
        if (typeof tool === 'string' && tool.trim()) {
            parsed.action = {
                tool: tool.trim(),
                input: (action as Record<string, unknown>).input,
            }
        }
    }

    return parsed
}
