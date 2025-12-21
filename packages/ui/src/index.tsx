// CLI 入口：提供交互式/一次性两种模式，负责 Session 管理与日志输出。
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { render } from 'ink'
import {
    createAgentSession,
    loadMemoConfig,
    writeMemoConfig,
    selectProvider,
    type AgentSessionDeps,
    type AgentSessionOptions,
    type MemoConfig,
} from '@memo/core'
import { App } from './tui/App'

type CliOptions = {
    once: boolean
}

type ParsedArgs = {
    question: string
    options: CliOptions
}

/** 简易 argv 解析，仅支持 --once 开关。 */
function parseArgs(argv: string[]): ParsedArgs {
    const options: CliOptions = {
        once: false,
    }
    const questionParts: string[] = []

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === undefined) {
            continue
        }
        if (arg === '--once') {
            options.once = true
            continue
        }
        questionParts.push(arg)
    }

    return { question: questionParts.join(' '), options }
}

async function ensureProviderConfig() {
    const loaded = await loadMemoConfig()
    if (!loaded.needsSetup) return loaded

    const defaultProvider = loaded.config.providers[0]
    const envCandidates = [
        defaultProvider?.env_api_key,
        'OPENAI_API_KEY',
        'DEEPSEEK_API_KEY',
    ].filter(Boolean) as string[]

    const hasEnvKey = envCandidates.some((key) => Boolean(process.env[key]))

    if (defaultProvider && hasEnvKey) {
        await writeMemoConfig(loaded.configPath, loaded.config)
        console.log(
            `检测到环境变量，已使用默认 provider (${defaultProvider.name}) 写入配置: ${loaded.configPath}`,
        )
        return { ...loaded, needsSetup: false }
    }

    const rl = createInterface({ input, output })
    const ask = async (prompt: string, fallback: string) => {
        const ans = (await rl.question(prompt)).trim()
        return ans || fallback
    }

    try {
        console.log('未检测到可用的 provider 配置，请按提示输入：')
        const name = await ask('Provider 名称 [deepseek]: ', 'deepseek')
        const envKey = await ask('API Key 环境变量名 [DEEPSEEK_API_KEY]: ', 'DEEPSEEK_API_KEY')
        const model = await ask('模型名称 [deepseek-chat]: ', 'deepseek-chat')
        const baseUrl = await ask(
            'Base URL [https://api.deepseek.com]: ',
            'https://api.deepseek.com',
        )

        const config: MemoConfig = {
            current_provider: name,
            max_steps: loaded.config.max_steps ?? 100,
            providers: [
                {
                    name,
                    env_api_key: envKey,
                    model,
                    base_url: baseUrl || undefined,
                },
            ],
        }
        await writeMemoConfig(loaded.configPath, config)
        console.log(`配置已写入 ${loaded.configPath}\n`)
        return { ...loaded, config, needsSetup: false }
    } finally {
        rl.close()
    }
}

async function runPlainMode(parsed: ParsedArgs) {
    const loaded = await ensureProviderConfig()
    const provider = selectProvider(loaded.config)
    const sessionId = randomUUID()
    const sessionOptions: AgentSessionOptions = {
        sessionId,
        mode: 'once',
        stream: loaded.config.stream_output ?? false,
    }

    const deps: AgentSessionDeps = {
        onAssistantStep: (text: string) => {
            process.stdout.write(text)
        },
        hooks: {
            onAction: ({ action }) => {
                console.log(`\n[tool] ${action.tool}`)
                if (action.input !== undefined) {
                    console.log(`[input] ${JSON.stringify(action.input)}`)
                }
            },
            onObservation: ({ tool, observation }) => {
                console.log(`\n[tool-result] ${tool}\n${observation}`)
            },
        },
    }

    const session = await createAgentSession(deps, sessionOptions)

    let question = parsed.question
    if (!question && !process.stdin.isTTY) {
        question = await readStdin()
    }
    if (!question && parsed.options.once) {
        question = '给我做一个自我介绍'
    }
    if (!question) {
        console.error('未提供输入，请传入问题或使用 stdin。')
        await session.close()
        return
    }

    try {
        console.log(`用户: ${question}\n`)
        const turnResult = await session.runTurn(question)
        if (!loaded.config.stream_output) {
            console.log(`\n${turnResult.finalText}`)
        }
        console.log(
            `\n[tokens] prompt=${turnResult.tokenUsage.prompt} completion=${turnResult.tokenUsage.completion} total=${turnResult.tokenUsage.total}`,
        )
        console.log(`\nprovider=${provider.name} model=${provider.model}`)
    } catch (err) {
        console.error(`运行失败: ${(err as Error).message}`)
    } finally {
        await session.close()
    }
}

async function runInteractiveTui(parsed: ParsedArgs) {
    const loaded = await ensureProviderConfig()
    const provider = selectProvider(loaded.config)
    const sessionId = randomUUID()
    const sessionOptions: AgentSessionOptions = {
        sessionId,
        mode: 'interactive',
        stream: loaded.config.stream_output ?? false,
    }

    const app = render(
        <App
            sessionOptions={sessionOptions}
            providerName={provider.name}
            model={provider.model}
            streamOutput={loaded.config.stream_output ?? false}
            configPath={loaded.configPath}
            mcpServerNames={Object.keys(loaded.config.mcp_servers ?? {})}
        />,
        { exitOnCtrlC: false },
    )
    await app.waitUntilExit()
}

async function main() {
    const parsed = parseArgs(process.argv.slice(2))
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY
    if (!isInteractive || parsed.options.once) {
        await runPlainMode(parsed)
        return
    }
    await runInteractiveTui(parsed)
}

void main()

async function readStdin(): Promise<string> {
    return new Promise((resolve) => {
        let data = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (chunk) => {
            data += chunk
        })
        process.stdin.on('end', () => {
            resolve(data.trim())
        })
        process.stdin.resume()
    })
}
