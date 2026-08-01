import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
    loadMemoConfig,
    writeMemoConfig,
    selectProvider,
    resolveContextWindowForProvider,
    getSessionsDir,
    type AgentSessionOptions,
    type LoadedConfig,
    type MemoConfig,
    type ProviderConfig,
} from '@memo/core'

export async function ensureProviderConfig(mode: 'plain' | 'tui') {
    const loaded = await loadMemoConfig()
    if (!loaded.needsSetup) return loaded

    const defaultProvider = loaded.config.providers[0]
    const envCandidates = [defaultProvider?.env_api_key, 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY'].filter(
        Boolean,
    ) as string[]

    const hasEnvKey = envCandidates.some((key) => Boolean(process.env[key]))

    if (defaultProvider && hasEnvKey) {
        await writeMemoConfig(loaded.configPath, loaded.config)
        return { ...loaded, needsSetup: false }
    }

    if (mode === 'tui') {
        return loaded
    }

    const rl = createInterface({ input, output })
    const ask = async (prompt: string, fallback: string) => {
        const ans = (await rl.question(prompt)).trim()
        return ans || fallback
    }

    try {
        console.log('No provider config found. Please answer the prompts:')
        const name = await ask('Provider name [deepseek]: ', 'deepseek')
        const envKey = await ask('API key env var [DEEPSEEK_API_KEY]: ', 'DEEPSEEK_API_KEY')
        const model = await ask('Model name [deepseek-chat]: ', 'deepseek-chat')
        const baseUrl = await ask('Base URL [https://api.deepseek.com]: ', 'https://api.deepseek.com')

        const config: MemoConfig = {
            current_provider: name,
            providers: [{ name, env_api_key: envKey, model, base_url: baseUrl || undefined }],
        }
        await writeMemoConfig(loaded.configPath, config)
        console.log(`Config written to ${loaded.configPath}\n`)
        return { ...loaded, config, needsSetup: false }
    } finally {
        rl.close()
    }
}

export async function buildRunContext(
    loaded: LoadedConfig,
    dangerous: boolean,
): Promise<{ provider: ProviderConfig; sessionOptions: AgentSessionOptions; sessionsDir: string }> {
    const provider = selectProvider(loaded.config)
    const contextWindow = resolveContextWindowForProvider(loaded.config, provider)
    const sessionOptions: AgentSessionOptions = {
        sessionId: randomUUID(),
        mode: 'interactive',
        contextWindow,
        autoCompactThresholdPercent: loaded.config.auto_compact_threshold_percent,
        activeMcpServers: loaded.config.active_mcp_servers,
        dangerous,
    }
    const sessionsDir = getSessionsDir(loaded, sessionOptions)
    return { provider, sessionOptions, sessionsDir }
}
