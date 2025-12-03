import type { ParsedAssistant, ToolName, ChatMessage, DeepSeekResponse } from "./types"
export const HISTORY_FILE = "history.xml"

export async function loadSystemPrompt() {
    try {
        return await Bun.file("prompt.tmpl").text()
    } catch (err) {
        throw new Error(`无法读取系统提示词 prompt.tmpl: ${(err as Error).message}`)
    }
}

export function parseAssistant(content: string): ParsedAssistant {
    const actionMatch = content.match(
        /<action[^>]*tool="([^"]+)"[^>]*>([\s\S]*?)<\/action>/i,
    )
    const finalMatch = content.match(/<final>([\s\S]*?)<\/final>/i)

    const parsed: ParsedAssistant = {}
    if (actionMatch) {
        parsed.action = {
            tool: actionMatch[1] as ToolName,
            input: actionMatch[2]?.trim() ?? "",
        }
    }
    if (finalMatch) {
        parsed.final = finalMatch[1]?.trim()
    }

    return parsed
}

export async function writeHistory(logEntries: string[]) {
    const startedAt = new Date().toISOString()
    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<history startedAt="${startedAt}">`,
        ...logEntries,
        "</history>",
        "",
    ].join("\n")
    await Bun.write(HISTORY_FILE, xml)
}

export function escapeCData(content: string) {
    return content.replaceAll("]]>", "]]]]><![CDATA[>")
}

export function wrapMessage(role: string, content: string) {
    return `  <message role="${role}">\n    <![CDATA[\n${escapeCData(content)}\n    ]]>\n  </message>`
}

export async function callDeepSeek(messages: ChatMessage[]): Promise<string> {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
        throw new Error("缺少环境变量 DEEPSEEK_API_KEY")
    }

    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: "deepseek-chat",
            messages,
            temperature: 0.35,
        }),
    })

    if (!res.ok) {
        const text = await res.text()
        throw new Error(`DeepSeek API 错误: ${res.status} ${text}`)
    }

    const data = (await res.json()) as DeepSeekResponse
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== "string") {
        throw new Error("DeepSeek 返回内容为空")
    }
    return content
}
