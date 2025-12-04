import type { ChatMessage } from "@memo/core/types"
import { requestJson } from "@memo/core/utils/request"

type DeepSeekMessage = { content?: string }
type DeepSeekChoice = { message?: DeepSeekMessage }
type DeepSeekResponse = { choices?: DeepSeekChoice[] }

export async function callDeepSeek(messages: ChatMessage[]): Promise<string> {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
        throw new Error("缺少环境变量 DEEPSEEK_API_KEY")
    }

    const data = await requestJson<DeepSeekResponse>({
        url: "https://api.deepseek.com/v1/chat/completions",
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body: {
            model: "deepseek-chat",
            messages,
            temperature: 0.35,
        },
    })

    const content = data.choices?.[0]?.message?.content
    if (typeof content !== "string") {
        throw new Error("DeepSeek 返回内容为空")
    }
    return content
}
