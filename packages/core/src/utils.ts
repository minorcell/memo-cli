import type { ParsedAssistant } from "@memo/core/types"

/**
 * 将模型输出解析为 action/final 结构，依赖简单的 XML 片段正则。
 * 返回结构可能同时包含 action 与 final，调用方需自行判断优先级。
 */
export function parseAssistant(content: string): ParsedAssistant {
    // 基于简单正则抽取 XML 片段；确保 action/final 都可被识别
    const actionMatch = content.match(/<action[^>]*tool="([^"]+)"[^>]*>([\s\S]*?)<\/action>/i)
    const finalMatch = content.match(/<final>([\s\S]*?)<\/final>/i)

    const parsed: ParsedAssistant = {}
    if (actionMatch) {
        parsed.action = {
            tool: actionMatch[1] ?? "",
            input: actionMatch[2]?.trim() ?? "",
        }
    }
    if (finalMatch) {
        parsed.final = finalMatch[1]?.trim()
    }

    return parsed
}

/**
 * 在写入 CDATA 时转义结束标记，避免破坏 XML。
 */
export function escapeCData(content: string) {
    return content.replaceAll("]]>", "]]]]><![CDATA[>")
}

/**
 * 将对话消息包装为 <message> XML 片段，并使用 CDATA 保留原样输出。
 */
export function wrapMessage(role: string, content: string) {
    // 使用 CDATA 包裹，避免模型输出中的特殊符号破坏 XML
    return `  <message role="${role}">\n    <![CDATA[\n${escapeCData(content)}\n    ]]>\n  </message>`
}
