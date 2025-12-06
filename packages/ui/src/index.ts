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
        if (arg === "--once") {
            options.once = true
            continue
        }
        questionParts.push(arg)
    }

    return { question: questionParts.join(" "), options }
}

function buildHistorySinks(sessionId: string): { sinks: HistorySink[] } {
    const sinks: HistorySink[] = []
    const jsonlPath = join(HISTORY_DIR, `${sessionId}.jsonl`)
    sinks.push(new JsonlHistorySink(jsonlPath))
    return { sinks }
}

async function runInteractive(parsed: ParsedArgs) {
    const sessionId = randomUUID()
    const { sinks } = buildHistorySinks(sessionId)
    const sessionOptions: AgentSessionOptions = {
        sessionId,
        mode: parsed.options.once ? "once" : "interactive",
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
