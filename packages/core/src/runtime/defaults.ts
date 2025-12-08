import { TOOLKIT } from "@memo/tools"
import { createOpenAIClient } from "@memo/core/llm/openai"
import { createTokenCounter } from "@memo/core/llm/tokenizer"
import { buildSessionPath, getSessionsDir, loadMemoConfig, selectProvider } from "@memo/core/config/config"
import { JsonlHistorySink } from "@memo/core/runtime/history"
import { loadSystemPrompt as defaultLoadPrompt } from "@memo/core/runtime/prompt"
import { MAX_STEPS } from "@memo/core/config/constants"
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
    const config = await loadMemoConfig()
    const tools = deps.tools ?? TOOLKIT
    const loadPrompt = deps.loadPrompt ?? defaultLoadPrompt
    return {
        tools,
        callLLM:
            deps.callLLM ??
            (async (messages) => {
                const provider = selectProvider(config, options.providerName)
                const client = createOpenAIClient(provider)
                return client(messages)
            }),
        loadPrompt,
        historySinks:
            deps.historySinks ??
            [
                new JsonlHistorySink(
                    buildSessionPath(
                        getSessionsDir(config, options),
                        sessionId,
                    ),
                ),
            ],
        tokenCounter: deps.tokenCounter ?? createTokenCounter(options.tokenizerModel),
        maxSteps: options.maxSteps ?? config.max_steps ?? MAX_STEPS,
    }
}
