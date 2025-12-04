import type { ChatMessage } from "@memo/core/types"
import { requestJson } from "@memo/core/utils/request"

type LLMMessage = { content?: string }
type LLMChoice = { message?: LLMMessage }
type LLMResponse = { choices?: LLMChoice[] }

const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com"
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "deepseek-chat"

/**
 * OpenAI 兼容的聊天调用，默认指向 DeepSeek（模型 `deepseek-chat`，Base URL `https://api.deepseek.com`）。
 * 约定优先读取 `OPENAI_API_KEY`，缺失时回退 `DEEPSEEK_API_KEY`。
 * @throws 缺少密钥或响应体异常时抛错。
 */
export async function callLLM(messages: ChatMessage[]): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
        throw new Error("缺少环境变量 OPENAI_API_KEY（或 DEEPSEEK_API_KEY）")
    }

    const data = await requestJson<LLMResponse>({
        url: `${DEFAULT_BASE_URL}/v1/chat/completions`,
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body: {
            model: DEFAULT_MODEL,
            messages,
            temperature: 0.35,
        },
    })

    const content = data.choices?.[0]?.message?.content
    if (typeof content !== "string") {
        throw new Error("OpenAI 兼容接口返回内容为空")
    }
    return content
}
