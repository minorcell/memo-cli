import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { parse } from "toml"
import type { AgentSessionOptions } from "@memo/core/types"

export type ProviderConfig = {
    name: string
    env_api_key: string
    model: string
    base_url?: string
}

export type MemoConfig = {
    current_provider: string
    max_steps?: number
    providers: ProviderConfig[]
}

const DEFAULT_MEMO_HOME = join(homedir(), ".memo")
const DEFAULT_SESSIONS_DIR = "sessions"

const DEFAULT_CONFIG: MemoConfig = {
    current_provider: "deepseek",
    max_steps: 100,
    providers: [
        {
            name: "deepseek",
            env_api_key: "DEEPSEEK_API_KEY",
            model: "deepseek-chat",
            base_url: "https://api.deepseek.com",
        },
    ],
}

function expandHome(path: string) {
    if (path.startsWith("~")) {
        return join(homedir(), path.slice(1))
    }
    return path
}

function serializeConfig(config: MemoConfig) {
    const providers = config.providers
        .map(
            (p) =>
                `[[providers]]
name = "${p.name}"
env_api_key = "${p.env_api_key}"
model = "${p.model}"
${p.base_url ? `base_url = "${p.base_url}"\n` : ""}`
        )
        .join("\n")
    return `# Memo config (auto-generated). Edit to change provider/model/base_url.
current_provider = "${config.current_provider}"
max_steps = ${config.max_steps ?? 100}

${providers}`.trim()
}

async function writeConfig(path: string, config: MemoConfig) {
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, serializeConfig(config))
}

export async function loadMemoConfig(): Promise<MemoConfig & { home: string; configPath: string }> {
    const home = process.env.MEMO_HOME ? expandHome(process.env.MEMO_HOME) : DEFAULT_MEMO_HOME
    const configPath = join(home, "config.toml")
    try {
        const file = Bun.file(configPath)
        if (!(await file.exists())) {
            await writeConfig(configPath, DEFAULT_CONFIG)
            return { ...DEFAULT_CONFIG, home, configPath }
        }
        const text = await file.text()
        const parsed = parse(text) as MemoConfig
        // 粗校验：至少需要 provider
        if (!parsed.providers?.length) {
            await writeConfig(configPath, DEFAULT_CONFIG)
            return { ...DEFAULT_CONFIG, home, configPath }
        }
        return { ...parsed, home, configPath }
    } catch {
        // 解析失败时回退默认配置
        await writeConfig(configPath, DEFAULT_CONFIG)
        return { ...DEFAULT_CONFIG, home, configPath }
    }
}

export function selectProvider(config: MemoConfig, preferred?: string): ProviderConfig {
    const name = preferred || config.current_provider
    const found = config.providers.find((p) => p.name === name)
    if (found) return found
    return config.providers?.[0] ?? DEFAULT_CONFIG.providers[0]!
}

export function getSessionsDir(config: MemoConfig & { home: string }, options: AgentSessionOptions) {
    const base = options.historyDir ?? join(config.home, DEFAULT_SESSIONS_DIR)
    return expandHome(base)
}

export function buildSessionPath(baseDir: string, sessionId: string) {
    const now = new Date()
    const yy = String(now.getFullYear()).slice(2)
    const mm = String(now.getMonth() + 1).padStart(2, "0")
    const dd = String(now.getDate()).padStart(2, "0")
    return join(baseDir, yy, mm, dd, `${sessionId}.jsonl`)
}

/** 提供一个新的 sessionId，便于外部复用。 */
export function createSessionId() {
    return randomUUID()
}
