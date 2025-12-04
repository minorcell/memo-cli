import type { ParsedAssistant } from "@memo/core/types"

export function parseAssistant(content: string): ParsedAssistant {
    // 基于简单正则抽取 XML 片段；确保 action/final 都可被识别
    const actionMatch = content.match(
        /<action[^>]*tool="([^"]+)"[^>]*>([\s\S]*?)<\/action>/i,
    )
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

export function escapeCData(content: string) {
    return content.replaceAll("]]>", "]]]]><![CDATA[>")
}

export function wrapMessage(role: string, content: string) {
    // 使用 CDATA 包裹，避免模型输出中的特殊符号破坏 XML
    return `  <message role="${role}">\n    <![CDATA[\n${escapeCData(content)}\n    ]]>\n  </message>`
}
