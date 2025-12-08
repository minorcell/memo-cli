import OpenAI from "openai"
import type { ProviderConfig } from "@memo/core/config/config"
import type { ChatMessage, LLMResponse } from "@memo/core/types"

const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com"
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "deepseek-chat"

function resolveApiKey(envKey?: string) {
    if (!envKey) return process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY
    return process.env[envKey] ?? process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY
}

/** 根据 provider 配置创建一个 LLM 调用函数。 */
export function createOpenAIClient(
    provider: Pick<ProviderConfig, "env_api_key" | "model" | "base_url">,
) {
    const apiKey = resolveApiKey(provider.env_api_key)
    if (!apiKey) {
        throw new Error(
            `缺少环境变量 ${provider.env_api_key}（或 OPENAI_API_KEY/DEEPSEEK_API_KEY）`,
        )
    }
    const client = new OpenAI({
        apiKey,
        baseURL: provider.base_url || DEFAULT_BASE_URL,
    })

    return async (messages: ChatMessage[]): Promise<LLMResponse> => {
        const data = await client.chat.completions.create({
            model: provider.model || DEFAULT_MODEL,
            messages,
            temperature: 0.35,
        })

        const content = data.choices?.[0]?.message?.content
        if (typeof content !== "string") {
            throw new Error("OpenAI 兼容接口返回内容为空")
        }
        return {
            content,
            usage: {
                prompt: data.usage?.prompt_tokens ?? undefined,
                completion: data.usage?.completion_tokens ?? undefined,
                total: data.usage?.total_tokens ?? undefined,
            },
        }
    }
}

/**
 * 兼容旧调用方式：使用环境变量提供 baseURL/model。
 */
export async function callLLM(messages: ChatMessage[]): Promise<LLMResponse> {
    const client = createOpenAIClient({
        env_api_key: process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY",
        model: DEFAULT_MODEL,
        base_url: DEFAULT_BASE_URL,
    })
    return client(messages)
}
