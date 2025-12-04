// 简易 CLI（占位 UI 层）：调用 Core 的 runAgent 与 Tools 集合
import { TOOLKIT } from "@memo/tools"
import {
    runAgent,
    loadSystemPrompt,
    writeHistory,
    HISTORY_FILE,
    callDeepSeek,
    type AgentResult,
    type AgentDeps,
} from "@memo/core"

async function run(question: string): Promise<AgentResult> {
    const deps: AgentDeps = {
        tools: TOOLKIT,
        callLLM: callDeepSeek,
        loadPrompt: loadSystemPrompt,
        writeHistory: (logs: string[]) => writeHistory(logs, HISTORY_FILE),
        onAssistantStep: (text: string, step: number) => {
            console.log(`\n[LLM 第 ${step + 1} 轮输出]\n${text}\n`)
        },
    }
    return runAgent(question, deps)
}

async function main() {
    const userQuestion = process.argv.slice(2).join(" ") || "给我做一个自我介绍"
    console.log(`用户问题: ${userQuestion}`)

    let logEntries: string[] = []
    try {
        const result = await run(userQuestion)
        logEntries = result.logEntries
        console.log("\n=== 最终回答 ===")
        console.log(result.answer)
    } catch (err) {
        console.error(`运行失败: ${(err as Error).message}`)
    } finally {
        if (logEntries.length) {
            try {
                await writeHistory(logEntries, HISTORY_FILE)
                console.log(`\n对话已写入 ${HISTORY_FILE}`)
            } catch (writeErr) {
                console.error(`记录 history 失败: ${(writeErr as Error).message}`)
            }
        }
    }
}

await main()
