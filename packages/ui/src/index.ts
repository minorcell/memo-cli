// CLI 入口：提供交互式/一次性两种模式，负责 Session 管理与日志输出。
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
    createAgentSession,
    loadMemoConfig,
    writeMemoConfig,
    type AgentSessionDeps,
    type AgentSessionOptions,
    type MemoConfig,
} from '@memo/core'

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

async function runInteractive(parsed: ParsedArgs) {
    await ensureProviderConfig()
    const sessionId = randomUUID()
    const sessionOptions: AgentSessionOptions = {
        sessionId,
        mode: parsed.options.once ? 'once' : 'interactive',
    }

    const streamedSteps = new Set<number>()
    const deps: AgentSessionDeps = {
        onAssistantStep: (text: string, step: number) => {
            if (!streamedSteps.has(step)) {
                streamedSteps.add(step)
                process.stdout.write(`\n[LLM 第 ${step + 1} 轮输出]\n`)
            }
            process.stdout.write(text)
        },
        onObservation: (tool: string, observation: string, step: number) => {
            console.log(`\n[第 ${step + 1} 步 工具=${tool}]\n${observation}\n`)
        },
    }

    const session = await createAgentSession(deps, sessionOptions)

    const rl = createInterface({ input, output })
    let nextQuestion = parsed.question
    if (parsed.options.once && !nextQuestion) {
        nextQuestion = '给我做一个自我介绍'
    }

    try {
        while (true) {
            const userInput = nextQuestion || (await rl.question('> '))
            nextQuestion = ''
            const trimmed = userInput.trim()
            if (!trimmed) {
                continue
            }
            if (trimmed === '/exit') {
                break
            }

            console.log(`\n用户: ${trimmed}`)
            const turnResult = await session.runTurn(trimmed)
            console.log('\n=== 最终回答 ===')
            console.log(turnResult.finalText)
            console.log(
                `\n[tokens] prompt=${turnResult.tokenUsage.prompt} completion=${turnResult.tokenUsage.completion} total=${turnResult.tokenUsage.total}`,
            )

            if (parsed.options.once) {
                break
            }
        }
    } catch (err) {
        console.error(`运行失败: ${(err as Error).message}`)
    } finally {
        rl.close()
        await session.close()
    }
}

async function main() {
    const parsed = parseArgs(process.argv.slice(2))
    await runInteractive(parsed)
}

void main()
