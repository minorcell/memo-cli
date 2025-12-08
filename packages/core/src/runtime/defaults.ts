import { TOOLKIT } from "@memo/tools"
import OpenAI from "openai"
import { createTokenCounter } from "@memo/core/utils/tokenizer"
import {
    buildSessionPath,
    getSessionsDir,
    loadMemoConfig,
    selectProvider,
} from "@memo/core/config/config"
import { JsonlHistorySink } from "@memo/core/runtime/history"
import { loadSystemPrompt as defaultLoadPrompt } from "@memo/core/runtime/prompt"
import type {
    AgentSessionDeps,
    AgentSessionOptions,
    CallLLM,
    HistorySink,
    TokenCounter,
    ToolRegistry,
} from "@memo/core/types"

/**
 * 根据缺省策略补全依赖项（工具、callLLM、prompt、history sinks、tokenizer）。
 * 调用方可仅提供回调/覆盖项，其余使用默认实现。
 */
export async function withDefaultDeps(
    deps: AgentSessionDeps,
    options: AgentSessionOptions,
    sessionId: string,
): Promise<{
    tools: ToolRegistry
    callLLM: CallLLM
    loadPrompt: () => Promise<string>
    historySinks: HistorySink[]
    tokenCounter: TokenCounter
    maxSteps: number
}> {
    const loaded = await loadMemoConfig()
    const config = loaded.config
    const tools = deps.tools ?? TOOLKIT
    const loadPrompt = deps.loadPrompt ?? defaultLoadPrompt
    return {
        tools,
        callLLM:
            deps.callLLM ??
            (async (messages) => {
                const provider = selectProvider(config, options.providerName)
                const apiKey =
                    process.env[provider.env_api_key] ??
                    process.env.OPENAI_API_KEY ??
                    process.env.DEEPSEEK_API_KEY
                if (!apiKey) {
                    throw new Error(
                        `缺少环境变量 ${provider.env_api_key}（或 OPENAI_API_KEY/DEEPSEEK_API_KEY）`,
                    )
                }
                const client = new OpenAI({
                    apiKey,
                    baseURL: provider.base_url,
                })
                const data = await client.chat.completions.create({
                    model: provider.model,
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
            }),
        loadPrompt,
        historySinks: deps.historySinks ?? [
            new JsonlHistorySink(buildSessionPath(getSessionsDir(loaded, options), sessionId)),
        ],
        tokenCounter: deps.tokenCounter ?? createTokenCounter(options.tokenizerModel),
        maxSteps: options.maxSteps ?? config.max_steps ?? 100,
    }
}
