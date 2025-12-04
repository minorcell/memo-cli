// Agent 核心：ReAct 循环与依赖注入
import { loadSystemPrompt as defaultLoadPrompt } from "@memo/core/prompt"
import { writeHistory as defaultWriteHistory, HISTORY_FILE } from "@memo/core/history"
import { parseAssistant, wrapMessage } from "@memo/core/utils"
import type { AgentDeps, AgentResult, ChatMessage } from "@memo/core/types"

export const MAX_STEPS = 100

export async function runAgent(
    question: string,
    deps: AgentDeps,
): Promise<AgentResult> {
    const {
        tools,
        callLLM,
        loadPrompt = defaultLoadPrompt,
        writeHistory = defaultWriteHistory,
        historyFilePath = HISTORY_FILE,
    } = deps

    const systemPrompt = await loadPrompt()
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
        const assistantText = await callLLM(history)
        deps.onAssistantStep?.(assistantText, step)
        history.push({ role: "assistant", content: assistantText })
        log("assistant", assistantText)

        const parsed = parseAssistant(assistantText)
        if (parsed.final) {
            return { answer: parsed.final, logEntries }
        }

        if (parsed.action) {
            const toolFn = tools[parsed.action.tool]
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

export * from "@memo/core/types"
export * from "@memo/core/prompt"
export * from "@memo/core/history"
export * from "@memo/core/utils"
export * from "@memo/core/llm/deepseek"
