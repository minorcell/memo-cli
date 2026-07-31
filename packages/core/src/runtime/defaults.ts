/** @file Session default dependency assembly: toolset, LLM, history sinks, tokenizer, etc. */
import { NATIVE_TOOLS } from '@memo/tools'
import OpenAI from 'openai'
import { createTokenCounter } from '@memo/core/utils/tokenizer'
import { buildSessionPath, getSessionsDir, loadMemoConfig, selectProvider } from '@memo/core/config/config'
import { JsonlHistorySink } from '@memo/core/runtime/history'
import { buildChatCompletionRequest, resolveModelProfile } from '@memo/core/runtime/model_profile'
import { loadSystemPrompt as defaultLoadPrompt } from '@memo/core/runtime/prompt'
import { ToolRouter } from '@memo/tools/router'
import type {
    AgentSessionDeps,
    AgentSessionOptions,
    CallLLM,
    ChatMessage,
    HistorySink,
    TokenCounter,
    ToolRegistry,
} from '@memo/core/types'
import type { MCPServerConfig } from '@memo/core/config/config'

export function filterMcpServersBySelection(
    servers: Record<string, MCPServerConfig> | undefined,
    activeNames: string[] | undefined,
): Record<string, MCPServerConfig> | undefined {
    if (!servers) return servers
    if (!activeNames) return servers

    const selected = new Set(activeNames.map((name) => name.trim()).filter(Boolean))
    if (selected.size === 0) return {}

    const filtered: Record<string, MCPServerConfig> = {}
    for (const [name, config] of Object.entries(servers)) {
        if (selected.has(name)) {
            filtered[name] = config
        }
    }
    return filtered
}

export function parseToolArguments(
    raw: string,
): { ok: true; data: unknown } | { ok: false; raw: string; error: string } {
    try {
        return { ok: true, data: JSON.parse(raw) }
    } catch (err) {
        return { ok: false, raw, error: (err as Error).message }
    }
}

function toOpenAIMessage(message: ChatMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
    if (message.role === 'assistant') {
        const assistantMessage: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
            reasoning_content?: string
        } = {
            role: 'assistant',
            content: message.content,
            tool_calls: message.tool_calls?.map((toolCall) => ({
                id: toolCall.id,
                type: toolCall.type,
                function: {
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                },
            })),
        }
        if (message.reasoning_content) {
            assistantMessage.reasoning_content = message.reasoning_content
        }
        return assistantMessage as OpenAI.Chat.Completions.ChatCompletionMessageParam
    }
    if (message.role === 'tool') {
        return {
            role: 'tool',
            content: message.content,
            tool_call_id: message.tool_call_id,
        }
    }
    return {
        role: message.role,
        content: message.content,
    }
}

function extractReasoningContent(
    message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined,
): string | undefined {
    const raw = (message as { reasoning_content?: unknown } | undefined)?.reasoning_content
    if (typeof raw !== 'string') return undefined
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

function isChatCompletionResponse(value: unknown): value is OpenAI.Chat.Completions.ChatCompletion {
    if (!value || typeof value !== 'object') return false
    return Array.isArray((value as { choices?: unknown }).choices)
}

/**
 * Complete dependencies with default strategy (tools, callLLM, prompt, history sinks, tokenizer).
 * Caller can provide only callbacks/overrides, rest use default implementations.
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
    dispose: () => Promise<void>
    historyFilePath?: string
}> {
    const loaded = await loadMemoConfig()
    const config = loaded.config

    // 1. Initialize ToolRouter
    const router = new ToolRouter()

    // 2. Register built-in tools
    router.registerNativeTools(NATIVE_TOOLS)

    // 3. Load external MCP tools (follows MEMO_HOME)
    await router.loadMcpServers(filterMcpServersBySelection(config.mcp_servers, options.activeMcpServers), {
        memoHome: loaded.home,
        storeMode: config.mcp_oauth_credentials_store_mode,
        callbackPort: config.mcp_oauth_callback_port,
    })

    // 4. Merge user custom tools (deps.tools has highest priority)
    if (deps.tools) {
        for (const [name, tool] of Object.entries(deps.tools)) {
            // User custom tools override同名 tools in router
            router.registerNativeTool({
                name,
                description: tool.description,
                source: 'native',
                inputSchema: { type: 'object' }, // Simplified, should convert from tool in practice
                execute: tool.execute,
            })
        }
    }

    // 5. Get final tool registry
    const combinedTools = router.toRegistry()

    // 6. Build loadPrompt (includes tool descriptions)
    const loadPrompt = async () => {
        let basePrompt = deps.loadPrompt
            ? await deps.loadPrompt()
            : await defaultLoadPrompt({
                  cwd: options.cwd,
                  memoHome: loaded.home,
                  activeSkillPaths: config.active_skills,
              })

        // Inject tool descriptions into prompt (for non-Tool Use API mode)
        const toolDescriptions = router.generateToolDescriptions()
        if (toolDescriptions) {
            basePrompt += `\n\n${toolDescriptions}`
        }

        return basePrompt
    }

    // 7. Generate tool definitions (for Tool Use API)
    const toolDefinitions = router.generateToolDefinitions()

    const sessionsDir = getSessionsDir(loaded, options)
    const historyFilePath = buildSessionPath(sessionsDir, sessionId)
    const defaultHistorySink = new JsonlHistorySink(historyFilePath)

    return {
        tools: combinedTools,
        dispose: async () => {
            if (deps.dispose) await deps.dispose()
            await router.dispose()
        },
        callLLM:
            deps.callLLM ??
            (async (messages, _onChunk, callOptions) => {
                const provider = selectProvider(config, options.providerName)
                const apiKey =
                    process.env[provider.env_api_key] ?? process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY
                if (!apiKey) {
                    throw new Error(`Missing env var ${provider.env_api_key} (or OPENAI_API_KEY/DEEPSEEK_API_KEY)`)
                }
                const client = new OpenAI({
                    apiKey,
                    baseURL: provider.base_url,
                })
                const openAIMessages = messages.map(toOpenAIMessage)
                const { profile: modelProfile } = resolveModelProfile(provider, config.model_profiles)

                const effectiveToolDefinitions = callOptions?.tools ?? toolDefinitions
                const request = buildChatCompletionRequest({
                    model: provider.model,
                    messages: openAIMessages,
                    toolDefinitions: effectiveToolDefinitions,
                    profile: modelProfile,
                })

                const data = await client.chat.completions.create(request, {
                    signal: callOptions?.signal,
                })
                if (!isChatCompletionResponse(data)) {
                    throw new Error('Streaming response is not supported in core callLLM')
                }

                const message = data.choices?.[0]?.message
                const reasoningContent = extractReasoningContent(message)

                // 检查是否有工具调用
                if (message?.tool_calls && message.tool_calls.length > 0) {
                    const content: Array<
                        { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }
                    > = []

                    // 添加文本内容（如果有）
                    if (message.content) {
                        content.push({ type: 'text', text: message.content })
                    }

                    // 添加工具调用
                    for (const toolCall of message.tool_calls) {
                        if (toolCall.type === 'function') {
                            const parsedArgs = parseToolArguments(toolCall.function.arguments)
                            if (parsedArgs.ok) {
                                content.push({
                                    type: 'tool_use',
                                    id: toolCall.id,
                                    name: toolCall.function.name,
                                    input: parsedArgs.data,
                                })
                            } else {
                                content.push({
                                    type: 'text',
                                    text: `[tool_use parse error] ${parsedArgs.error}; raw: ${parsedArgs.raw}`,
                                })
                            }
                        }
                    }

                    const hasToolUse = content.some((c) => c.type === 'tool_use')
                    return {
                        content,
                        reasoning_content: reasoningContent,
                        stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
                        usage: {
                            prompt: data.usage?.prompt_tokens ?? undefined,
                            completion: data.usage?.completion_tokens ?? undefined,
                            total: data.usage?.total_tokens ?? undefined,
                        },
                    }
                }

                // 普通文本响应
                const content = message?.content
                if (typeof content !== 'string') {
                    throw new Error('OpenAI-compatible API returned empty content')
                }
                return {
                    content: [{ type: 'text', text: content }],
                    reasoning_content: reasoningContent,
                    stop_reason: 'end_turn',
                    usage: {
                        prompt: data.usage?.prompt_tokens ?? undefined,
                        completion: data.usage?.completion_tokens ?? undefined,
                        total: data.usage?.total_tokens ?? undefined,
                    },
                }
            }),
        loadPrompt,
        historySinks: deps.historySinks ?? [defaultHistorySink],
        tokenCounter: deps.tokenCounter ?? createTokenCounter(options.tokenizerModel),
        historyFilePath: historyFilePath,
    }
}
