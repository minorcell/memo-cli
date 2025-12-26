/** @file Session 默认依赖装配：工具集、LLM、历史 sink、tokenizer 等。 */
import { TOOLKIT } from '@memo/tools'
import OpenAI from 'openai'
import { createTokenCounter } from '@memo/core/utils/tokenizer'
import {
    buildSessionPath,
    getSessionsDir,
    getMemoryPath,
    loadMemoConfig,
    selectProvider,
} from '@memo/core/config/config'
import { JsonlHistorySink } from '@memo/core/runtime/history'
import { loadSystemPrompt as defaultLoadPrompt } from '@memo/core/runtime/prompt'
import { loadExternalMcpTools } from '@memo/core/runtime/mcp_client'
import type {
    AgentSessionDeps,
    AgentSessionOptions,
    CallLLM,
    HistorySink,
    TokenCounter,
    ToolRegistry,
} from '@memo/core/types'

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
    dispose: () => Promise<void>
    historyFilePath?: string
}> {
    const loaded = await loadMemoConfig()
    const config = loaded.config

    // 1. 加载外部 MCP 工具
    const { tools: mcpTools, cleanup } = await loadExternalMcpTools(config.mcp_servers)

    // 2. 合并工具: deps.tools > mcpTools > TOOLKIT
    const baseTools = deps.tools ?? TOOLKIT
    const combinedTools: ToolRegistry = { ...baseTools }
    for (const t of mcpTools) {
        combinedTools[t.name] = t
    }

    const loadPrompt = async () => {
        let basePrompt = await (deps.loadPrompt ?? defaultLoadPrompt)()

        // 如果存在外部工具，注入相关信息到 prompt
        if (mcpTools.length > 0) {
            const toolDescs = mcpTools
                .map((t) => {
                    const schema = (t as any)._rawJSONSchema
                        ? JSON.stringify((t as any)._rawJSONSchema)
                        : 'See description'
                    return `- **${t.name}**: ${t.description}\n  Schema: \`${schema}\``
                })
                .join('\n')

            basePrompt += `\n\n# External Tools\n${toolDescs}`
        }

        const memoryPath = getMemoryPath(loaded)
        try {
            const file = Bun.file(memoryPath)
            if (await file.exists()) {
                const memory = (await file.text()).trim()
                if (memory) {
                    return `${basePrompt}\n\n# Long-Term Memory\n${memory}`
                }
            }
        } catch (err) {
            console.warn(`Failed to read memo: ${(err as Error).message}`)
        }
        return basePrompt
    }
    const streamOutput = options.stream ?? config.stream_output ?? false
    const sessionsDir = getSessionsDir(loaded, options)
    const historyFilePath = buildSessionPath(sessionsDir, sessionId)
    const defaultHistorySink = new JsonlHistorySink(historyFilePath)

    return {
        tools: combinedTools,
        dispose: async () => {
            if (deps.dispose) await deps.dispose()
            await cleanup()
        },
        callLLM:
            deps.callLLM ??
            (async (messages, onChunk, callOptions) => {
                const provider = selectProvider(config, options.providerName)
                const apiKey =
                    process.env[provider.env_api_key] ??
                    process.env.OPENAI_API_KEY ??
                    process.env.DEEPSEEK_API_KEY
                if (!apiKey) {
                    throw new Error(
                        `Missing env var ${provider.env_api_key} (or OPENAI_API_KEY/DEEPSEEK_API_KEY)`,
                    )
                }
                const client = new OpenAI({
                    apiKey,
                    baseURL: provider.base_url,
                })
                if (streamOutput) {
                    const stream = await client.chat.completions.create(
                        {
                            model: provider.model,
                            messages,
                            temperature: 0.35,
                            stream: true,
                        },
                        { signal: callOptions?.signal },
                    )
                    let content = ''
                    for await (const part of stream) {
                        const delta = part.choices?.[0]?.delta?.content
                        if (delta) {
                            content += delta
                            onChunk?.(delta)
                        }
                    }
                    return { content, streamed: true }
                } else {
                    const data = await client.chat.completions.create(
                        {
                            model: provider.model,
                            messages,
                            temperature: 0.35,
                        },
                        { signal: callOptions?.signal },
                    )
                    const content = data.choices?.[0]?.message?.content
                    if (typeof content !== 'string') {
                        throw new Error('OpenAI-compatible API returned empty content')
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
            }),
        loadPrompt,
        historySinks: deps.historySinks ?? [defaultHistorySink],
        tokenCounter: deps.tokenCounter ?? createTokenCounter(options.tokenizerModel),
        maxSteps: options.maxSteps ?? config.max_steps ?? 100,
        historyFilePath: historyFilePath,
    }
}
