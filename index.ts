// 入口：运行 ReAct Agent，调用 DeepSeek 与工具集，落盘对话到 history.xml
import { TOOLKIT } from "./tools"
import type { ToolName, AgentResult, ChatMessage } from "./types"
import { loadSystemPrompt, parseAssistant, writeHistory, wrapMessage, callDeepSeek, HISTORY_FILE } from "./utils"
export const MAX_STEPS = 100

async function runAgent(question: string): Promise<AgentResult> {
    const systemPrompt = await loadSystemPrompt()
    const logEntries: string[] = []
    const log = (role: string, content: string) => {
        logEntries.push(wrapMessage(role, content))
    }

    log("system", systemPrompt)
    log("user", question)

    const history: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
    ]

    for (let step = 0; step < MAX_STEPS; step++) {
        const assistantText = await callDeepSeek(history)
        console.log(`\n[LLM 第 ${step + 1} 轮输出]\n${assistantText}\n`)
        history.push({ role: "assistant", content: assistantText })
        log("assistant", assistantText)

        const parsed = parseAssistant(assistantText)
        if (parsed.final) {
            return { answer: parsed.final, logEntries }
        }

        if (parsed.action) {
            const toolFn = TOOLKIT[parsed.action.tool as ToolName]
            let observation: string

            if (toolFn) {
                observation = await toolFn(parsed.action.input) // 只支持单工具调用
            } else {
                observation = `未知工具: ${parsed.action.tool}`
            }
            log("observation", observation)

            history.push({
                role: "user",
                content: `<observation>${observation}</observation>`,
            })
            continue
        }

        break // 未产生 action 或 final
    }

    const fallback = "未能生成最终回答，请重试或调整问题。"
    log("assistant", `<final>${fallback}</final>`)
    return { answer: fallback, logEntries }
}

async function main() {
    const userQuestion = process.argv.slice(2).join(" ") || "给我做一个自我介绍"
    console.log(`用户问题: ${userQuestion}`)

    let logEntries: string[] = []
    try {
        const result = await runAgent(userQuestion)
        logEntries = result.logEntries
        console.log("\n=== 最终回答 ===")
        console.log(result.answer)
    } catch (err) {
        console.error(`运行失败: ${(err as Error).message}`)
    } finally {
        if (logEntries.length) {
            try {
                await writeHistory(logEntries)
                console.log(`\n对话已写入 ${HISTORY_FILE}`)
            } catch (writeErr) {
                console.error(`记录 history 失败: ${(writeErr as Error).message}`)
            }
        }
    }
}

await main()
