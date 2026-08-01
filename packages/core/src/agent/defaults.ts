/** @file Session default dependency assembly: toolset, LLM, history sinks, tokenizer, etc. */
import type { ToolSet } from 'ai'
import { NATIVE_TOOLS } from '@memo/core/tools'
import { createTokenCounter } from '@memo/core/utils/tokenizer'
import { buildSessionPath, getSessionsDir, loadMemoConfig, selectProvider } from '@memo/core/config/config'
import { JsonlHistorySink } from '@memo/core/features/history'
import { resolveModelProfile } from '@memo/core/llm/model_profile'
import { streamCallLLM } from '@memo/core/llm/ai_stream'
import { getProviderFactory } from '@memo/core/llm/ai_provider'
import { loadSystemPrompt as defaultLoadPrompt } from '@memo/core/prompt/prompt'
import { McpToolRegistry } from '@memo/core/tools/router'
import { wrapToolSetWithRuntime } from '@memo/core/tools/sdk_tools'
import type { AgentSessionDeps, AgentSessionOptions, CallLLM, HistorySink, TokenCounter } from '@memo/core/types'
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

/**
 * Complete dependencies with default strategy (tools, callLLM, prompt, history sinks, tokenizer).
 * Caller can provide only callbacks/overrides, rest use default implementations.
 */
export async function withDefaultDeps(
    deps: AgentSessionDeps,
    options: AgentSessionOptions,
    sessionId: string,
): Promise<{
    tools: ToolSet
    callLLM: CallLLM
    loadPrompt: () => Promise<string>
    historySinks: HistorySink[]
    tokenCounter: TokenCounter
    dispose: () => Promise<void>
    historyFilePath?: string
}> {
    const loaded = await loadMemoConfig()
    const config = loaded.config

    // 1. Load external MCP tools (follows MEMO_HOME)
    const mcpRegistry = new McpToolRegistry()
    await mcpRegistry.loadServersWithOptions(
        filterMcpServersBySelection(config.mcp_servers, options.activeMcpServers),
        {
            memoHome: loaded.home,
            storeMode: config.mcp_oauth_credentials_store_mode,
            callbackPort: config.mcp_oauth_callback_port,
        },
    )

    // 2. Merge user custom tools (deps.tools has highest priority, keys are tool names)
    const combinedTools: ToolSet = {
        ...NATIVE_TOOLS,
        ...mcpRegistry.toToolSet(),
        ...deps.tools,
    }

    // 3. Wrap every tool execute with the runtime gate (approval / skip / truncation).
    // Context flows in per call via streamText experimental_context.
    const runtimeTools = wrapToolSetWithRuntime(combinedTools) ?? combinedTools

    // 6. Build loadPrompt (tool exposure is handled by the AI SDK tools schema, not prompt text)
    const loadPrompt = async () => {
        if (deps.loadPrompt) {
            return deps.loadPrompt()
        }
        return defaultLoadPrompt({
            cwd: options.cwd,
            memoHome: loaded.home,
            activeSkillPaths: config.active_skills,
        })
    }

    const sessionsDir = getSessionsDir(loaded, options)
    const historyFilePath = buildSessionPath(sessionsDir, sessionId)
    const defaultHistorySink = new JsonlHistorySink(historyFilePath)

    return {
        tools: runtimeTools,
        dispose: async () => {
            if (deps.dispose) await deps.dispose()
            await mcpRegistry.dispose()
        },
        callLLM:
            deps.callLLM ??
            (async (messages, onChunk, callOptions) => {
                const provider = selectProvider(config, options.providerName)
                const apiKey =
                    process.env[provider.env_api_key] ?? process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY
                if (!apiKey) {
                    throw new Error(`Missing env var ${provider.env_api_key} (or OPENAI_API_KEY/DEEPSEEK_API_KEY)`)
                }
                const { profile: modelProfile } = resolveModelProfile(provider, config.model_profiles)
                return streamCallLLM({
                    provider,
                    apiKey,
                    messages,
                    // toolContext absent (compaction) disables tools in streamCallLLM.
                    tools: runtimeTools,
                    profile: modelProfile,
                    factory: getProviderFactory(provider),
                    toolContext: callOptions?.toolContext,
                    thinking: callOptions?.thinking,
                    onChunk,
                    onReasoningChunk: callOptions?.onReasoningChunk,
                    signal: callOptions?.signal,
                })
            }),
        loadPrompt,
        historySinks: deps.historySinks ?? [defaultHistorySink],
        tokenCounter: deps.tokenCounter ?? createTokenCounter(),
        historyFilePath: historyFilePath,
    }
}
