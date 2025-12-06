// CLI 入口：提供交互式/一次性两种模式，负责 Session 管理与日志输出。
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { TOOLKIT } from "@memo/tools"
import {
    callLLM,
    createAgentSession,
    HISTORY_DIR,
    JsonlHistorySink,
    loadSystemPrompt,
    type AgentSessionDeps,
    type AgentSessionOptions,
    type HistorySink,
} from "@memo/core"

type CliOptions = {
    once: boolean
    logDir: string
    tokenizerModel?: string
    maxPromptTokens?: number
    warnPromptTokens?: number
    sessionId?: string
}

type ParsedArgs = {
    question: string
    options: CliOptions
}

/** 将字符串解析为数字，非法时返回 undefined，避免 NaN 污染配置。 */
function parseNumber(value?: string): number | undefined {
    if (!value) return undefined
    const num = Number(value)
    return Number.isFinite(num) ? num : undefined
}

/** 简易 argv 解析，支持 --once、日志格式与 token 限制等参数。 */
function parseArgs(argv: string[]): ParsedArgs {
    const options: CliOptions = {
        once: false,
        logDir: HISTORY_DIR,
    }
    const questionParts: string[] = []

    const takeNext = (idx: number) => argv[idx + 1]

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === undefined) {
            continue
        }
        if (arg === "--once") {
            options.once = true
            continue
        }
        if (arg === "--log-dir") {
            options.logDir = takeNext(i) ?? options.logDir
            i += 1
            continue
        }
        if (arg.startsWith("--log-dir=")) {
            options.logDir = arg.split("=")[1] || options.logDir
            continue
        }
        if (arg === "--tokenizer-model") {
            options.tokenizerModel = takeNext(i)
            i += 1
            continue
        }
        if (arg.startsWith("--tokenizer-model=")) {
            options.tokenizerModel = arg.split("=")[1]
            continue
        }
        if (arg === "--max-prompt-tokens") {
            options.maxPromptTokens = parseNumber(takeNext(i))
            i += 1
            continue
        }
        if (arg.startsWith("--max-prompt-tokens=")) {
            options.maxPromptTokens = parseNumber(arg.split("=")[1])
            continue
        }
        if (arg === "--warn-prompt-tokens") {
            options.warnPromptTokens = parseNumber(takeNext(i))
            i += 1
            continue
        }
        if (arg.startsWith("--warn-prompt-tokens=")) {
            options.warnPromptTokens = parseNumber(arg.split("=")[1])
            continue
        }
        if (arg === "--session-id") {
            options.sessionId = takeNext(i)
            i += 1
            continue
        }
        if (arg.startsWith("--session-id=")) {
            options.sessionId = arg.split("=")[1]
            continue
        }
        questionParts.push(arg)
    }

    return { question: questionParts.join(" "), options }
}

function buildHistorySinks(
    sessionId: string,
    options: CliOptions
): { sinks: HistorySink[] } {
    const sinks: HistorySink[] = []
    const jsonlPath = join(options.logDir, `${sessionId}.jsonl`)
    sinks.push(new JsonlHistorySink(jsonlPath))
    return { sinks }
}

async function runInteractive(parsed: ParsedArgs) {
    const sessionId = parsed.options.sessionId ?? randomUUID()
    const { sinks } = buildHistorySinks(sessionId, parsed.options)
    const sessionOptions: AgentSessionOptions = {
        sessionId,
        mode: parsed.options.once ? "once" : "interactive",
        tokenizerModel: parsed.options.tokenizerModel,
        maxPromptTokens: parsed.options.maxPromptTokens,
        warnPromptTokens: parsed.options.warnPromptTokens,
    }

    const deps: AgentSessionDeps = {
        tools: TOOLKIT,
        callLLM,
        loadPrompt: loadSystemPrompt,
        historySinks: sinks,
        onAssistantStep: (text: string, step: number) => {
            console.log(`\n[LLM 第 ${step + 1} 轮输出]\n${text}\n`)
        },
    }

    const session = await createAgentSession(deps, sessionOptions)
    console.log(`Session ${session.id} 已启动（模式: ${session.mode}）`)

    const rl = createInterface({ input, output })
    let nextQuestion = parsed.question
    if (parsed.options.once && !nextQuestion) {
        nextQuestion = "给我做一个自我介绍"
    }

    try {
        while (true) {
            const userInput = nextQuestion || (await rl.question("> "))
            nextQuestion = ""
            const trimmed = userInput.trim()
            if (!trimmed) {
                continue
            }
            if (trimmed === "/exit") {
                break
            }

            console.log(`\n用户: ${trimmed}`)
            const turnResult = await session.runTurn(trimmed)
            console.log("\n=== 最终回答 ===")
            console.log(turnResult.finalText)
            console.log(
                `\n[tokens] prompt=${turnResult.tokenUsage.prompt} completion=${turnResult.tokenUsage.completion} total=${turnResult.tokenUsage.total}`
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

await main()
