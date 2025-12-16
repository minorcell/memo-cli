/** @file 配置管理：读取/写入 ~/.memo/config.toml 及路径构造工具。 */
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse } from 'toml'
import type { AgentSessionOptions } from '@memo/core/types'

export type ProviderConfig = {
    name: string
    env_api_key: string
    model: string
    base_url?: string
}

export type MCPServerConfig =
    | {
          /** 默认：启动本地进程，通过 stdio 连接。 */
          type?: 'stdio'
          command: string
          args?: string[]
      }
    | {
          /** 通过 Streamable HTTP 连接远程 MCP（必要时可回退 SSE）。 */
          type?: 'streamable_http'
          url: string
          /** 失败时是否回退到 SSE 传输，默认 true。 */
          fallback_to_sse?: boolean
          /** 附加请求头（如鉴权）。 */
          headers?: Record<string, string>
      }
    | {
          /** 强制使用 SSE（旧版 HTTP 传输）。 */
          type: 'sse'
          url: string
          headers?: Record<string, string>
      }

export type MemoConfig = {
    current_provider: string
    max_steps?: number
    stream_output?: boolean
    /** Map of server name to server configuration */
    mcp_servers?: Record<string, MCPServerConfig>
    providers: ProviderConfig[]
}

const DEFAULT_MEMO_HOME = join(homedir(), '.memo')
const DEFAULT_SESSIONS_DIR = 'sessions'
const DEFAULT_MEMORY_FILE = 'memo.md'

const DEFAULT_CONFIG: MemoConfig = {
    current_provider: 'deepseek',
    max_steps: 100,
    stream_output: false,
    providers: [
        {
            name: 'deepseek',
            env_api_key: 'DEEPSEEK_API_KEY',
            model: 'deepseek-chat',
            base_url: 'https://api.deepseek.com',
        },
    ],
    mcp_servers: {},
}

function expandHome(path: string) {
    if (path.startsWith('~')) {
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
${p.base_url ? `base_url = "${p.base_url}"\n` : ''}`,
        )
        .join('\n\n')

    let mcpSection = ''
    if (config.mcp_servers && Object.keys(config.mcp_servers).length > 0) {
        mcpSection = Object.entries(config.mcp_servers)
            .map(([name, conf]) => {
                if ('url' in conf) {
                    const lines = [`[mcp_servers.${name}]`]
                    lines.push(`type = "${conf.type ?? 'streamable_http'}"`)
                    lines.push(`url = "${conf.url}"`)
                    if ('fallback_to_sse' in conf && conf.fallback_to_sse !== undefined) {
                        lines.push(`fallback_to_sse = ${conf.fallback_to_sse}`)
                    }
                    if (conf.headers && Object.keys(conf.headers).length > 0) {
                        const headerEntries = Object.entries(conf.headers)
                            .map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`)
                            .join(', ')
                        lines.push(`headers = { ${headerEntries} }`)
                    }
                    return lines.join('\n')
                }
                const argsLine = conf.args ? `args = ${JSON.stringify(conf.args)}` : ''
                const typeLine = conf.type ? `type = "${conf.type}"\n` : ''
                return `[mcp_servers.${name}]\n${typeLine}command = "${conf.command}"\n${argsLine}`
            })
            .join('\n\n')
    }

    const mainConfig = `
current_provider = "${config.current_provider}"
max_steps = ${config.max_steps ?? 100}
stream_output = ${config.stream_output ?? false}
`.trim()

    return [mainConfig, providers, mcpSection].filter(Boolean).join('\n\n')
}

export async function writeMemoConfig(path: string, config: MemoConfig) {
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, serializeConfig(config))
}

export type LoadedConfig = {
    config: MemoConfig
    home: string
    configPath: string
    needsSetup: boolean
}

export async function loadMemoConfig(): Promise<LoadedConfig> {
    const home = process.env.MEMO_HOME ? expandHome(process.env.MEMO_HOME) : DEFAULT_MEMO_HOME
    const configPath = join(home, 'config.toml')
    try {
        const file = Bun.file(configPath)
        if (!(await file.exists())) {
            return { config: DEFAULT_CONFIG, home, configPath, needsSetup: true }
        }
        const text = await file.text()
        const parsed = parse(text) as Partial<MemoConfig>
        const merged: MemoConfig = {
            current_provider: parsed.current_provider ?? DEFAULT_CONFIG.current_provider,
            max_steps: parsed.max_steps ?? DEFAULT_CONFIG.max_steps,
            stream_output: parsed.stream_output ?? DEFAULT_CONFIG.stream_output,
            providers: parsed.providers ?? [],
            mcp_servers: parsed.mcp_servers ?? {},
        }
        const needsSetup = !merged.providers.length
        return { config: needsSetup ? DEFAULT_CONFIG : merged, home, configPath, needsSetup }
    } catch {
        return { config: DEFAULT_CONFIG, home, configPath, needsSetup: true }
    }
}

export function selectProvider(config: MemoConfig, preferred?: string): ProviderConfig {
    const name = preferred || config.current_provider
    const found = config.providers.find((p) => p.name === name)
    if (found) return found
    return config.providers?.[0] ?? DEFAULT_CONFIG.providers[0]!
}

export function getSessionsDir(loaded: LoadedConfig, options: AgentSessionOptions) {
    const base = options.historyDir ?? join(loaded.home, DEFAULT_SESSIONS_DIR)
    return expandHome(base)
}

export function getMemoryPath(loaded: LoadedConfig) {
    return join(loaded.home, DEFAULT_MEMORY_FILE)
}

function sanitizePathComponent(raw: string, maxLen = 100) {
    const replaced = raw.replace(/[\\/:\s]+/g, '-')
    const collapsed = replaced.replace(/-+/g, '-')
    const trimmed = collapsed.replace(/^-+|-+$/g, '')
    const sliced = trimmed.slice(0, maxLen)
    return sliced || 'root'
}

function truncatePath(parts: string[], maxTotalLen = 180) {
    const result: string[] = []
    let current = 0
    for (const part of parts) {
        const safe = part.slice(0, Math.max(1, maxTotalLen - current - (result.length > 0 ? 1 : 0)))
        result.push(safe)
        current += safe.length + (result.length > 1 ? 1 : 0)
        if (current >= maxTotalLen) break
    }
    return result
}

export function buildSessionPath(baseDir: string, sessionId: string) {
    const now = new Date()
    const yyyy = String(now.getFullYear())
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const HH = String(now.getHours()).padStart(2, '0')
    const MM = String(now.getMinutes()).padStart(2, '0')
    const SS = String(now.getSeconds()).padStart(2, '0')
    const cwd = process.cwd()
    const safeParts = cwd.split(/[/\\]+/).map((p) => sanitizePathComponent(p))
    const truncatedParts = truncatePath(safeParts, 180)
    const dirName = truncatedParts.join('-')
    const fileName = `${yyyy}-${mm}-${dd}_${HH}${MM}${SS}_${sessionId}.jsonl`
    return join(baseDir, dirName, fileName)
}

/** 提供一个新的 sessionId，便于外部复用。 */
export function createSessionId() {
    return randomUUID()
}
