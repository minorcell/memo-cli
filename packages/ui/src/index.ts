// 简易 CLI（占位 UI 层）：调用 Core 的 runAgent 与 Tools 集合
import { TOOLKIT } from "@memo/tools"
import {
    runAgent,
    loadSystemPrompt,
    writeHistory,
    HISTORY_FILE,
    callLLM,
    type AgentResult,
    type AgentDeps,
} from "@memo/core"

/**
 * 包装一套默认依赖，供 CLI 调用 Agent。
 * - 使用 OpenAI 兼容接口，默认 DeepSeek 模型。
 * - 将工具注册表与日志回调传入。
 */
async function run(question: string): Promise<AgentResult> {
    const deps: AgentDeps = {
        tools: TOOLKIT,
        callLLM: callLLM,
        loadPrompt: loadSystemPrompt,
        writeHistory: (logs: string[]) => writeHistory(logs, HISTORY_FILE),
        onAssistantStep: (text: string, step: number) => {
            console.log(`\n[LLM 第 ${step + 1} 轮输出]\n${text}\n`)
        },
    }
    return runAgent(question, deps)
}

/**
 * CLI 入口：读取命令行问题，运行 Agent 并输出回答与历史。
 */
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
