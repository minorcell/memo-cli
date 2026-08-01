/** @file Session default dependency assembly: toolset, LLM, history sinks, tokenizer, etc. */
import { NATIVE_TOOLS } from '@memo/tools'
import { createTokenCounter } from '@memo/core/utils/tokenizer'
import { buildSessionPath, getSessionsDir, loadMemoConfig, selectProvider } from '@memo/core/config/config'
import { JsonlHistorySink } from '@memo/core/features/history'
import { resolveModelProfile } from '@memo/core/llm/model_profile'
import { streamCallLLM } from '@memo/core/llm/ai_stream'
import { getProviderFactory } from '@memo/core/llm/ai_provider'
import { loadSystemPrompt as defaultLoadPrompt } from '@memo/core/prompt/prompt'
import { ToolRouter } from '@memo/tools/router'
import type {
    AgentSessionDeps,
    AgentSessionOptions,
    CallLLM,
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
                    toolDefinitions: callOptions?.tools ?? toolDefinitions,
                    profile: modelProfile,
                    factory: getProviderFactory(provider),
                    onChunk,
                    signal: callOptions?.signal,
                })
            }),
        loadPrompt,
        historySinks: deps.historySinks ?? [defaultHistorySink],
        tokenCounter: deps.tokenCounter ?? createTokenCounter(options.tokenizerModel),
        historyFilePath: historyFilePath,
    }
}
