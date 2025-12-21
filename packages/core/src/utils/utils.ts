/** @file Runtime 公用的解析辅助函数集合。 */
import type { ParsedAssistant } from '@memo/core/types'

/**
 * 将模型输出解析为 Action 或 Final。
 * 策略：
 * 1. 寻找被 ```json ... ``` 包裹的 JSON 块。
 * 2. 如果找到且解析成功，提取为 action。
 * 3. 如果没找到，则将整个 content 视为 final。
 */
export function parseAssistant(content: string): ParsedAssistant {
    const parsed: ParsedAssistant = {}

    // 尝试提取 JSON Block
    // 匹配 ```json {...} ``` 或 ``` {...} ```
    // 同时也支持没有闭合 ``` 的情况（流式输出中断）
    const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/
    const match = content.match(jsonBlockRegex)

    if (match) {
        try {
            const jsonText = match[1] || ''
            if (!jsonText) return parsed // should not happen with regex
            const obj = JSON.parse(jsonText)

            // 检查是否是合法的 action 结构
            if (obj && typeof obj === 'object' && typeof obj.tool === 'string') {
                parsed.action = {
                    tool: obj.tool.trim(),
                    input: obj.input,
                }
                return parsed
            }
        } catch (e) {
            // JSON 解析失败，忽略，回退到视为纯文本
        }
    }

    // 尝试寻找 raw JSON (fallback, if model forgot code blocks but output strict JSON)
    // 仅当整个 content 看起来像个 JSON 对象时尝试
    const trimmed = content.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const obj = JSON.parse(trimmed)
            if (obj.tool) {
                parsed.action = { tool: obj.tool, input: obj.input }
                return parsed
            }
            // 支持旧格式 {"final": "..."}
            if (obj.final) {
                parsed.final = obj.final
                return parsed
            }
        } catch {
            // ignore
        }
    }

    // 默认：全部视为 final
    // 如果内容为空，则不视为 final（避免空消息结束回合）
    if (content.trim()) {
        parsed.final = content
    }

    return parsed
}
