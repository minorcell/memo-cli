/**
 * Agent 核心：基于 ReAct 模式的循环与依赖注入。
 * 尽量保持纯逻辑，依赖通过 AgentDeps 传入，方便在 CLI/UI 层复用或替换。
 */
import { loadSystemPrompt as defaultLoadPrompt } from "@memo/core/prompt"
import { writeHistory as defaultWriteHistory, HISTORY_FILE } from "@memo/core/history"
import { parseAssistant, wrapMessage } from "@memo/core/utils"
import type { AgentDeps, AgentResult, ChatMessage } from "@memo/core/types"

/** 安全兜底的最大循环次数，防止模型进入死循环。 */
export const MAX_STEPS = 100

/**
 * 执行 Agent 主流程：
 * 1. 加载系统提示词并拼装初始对话。
 * 2. 循环调用 LLM，解析 action/final。
 * 3. 调用工具并回写 observation，直到得到最终回答或超出步数。
 */
export async function runAgent(question: string, deps: AgentDeps): Promise<AgentResult> {
    const {
        tools,
        callLLM,
        loadPrompt = defaultLoadPrompt,
        writeHistory = defaultWriteHistory,
        historyFilePath = HISTORY_FILE,
    } = deps

    const systemPrompt = await loadPrompt()
    const logEntries: string[] = []
    // 统一的日志记录函数，便于最后写入 history。
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
                observation = await toolFn(parsed.action.input) // 目前仅支持单工具调用
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

        break // 未产生 action 或 final，退出循环防止空转
    }

    const fallback = "未能生成最终回答，请重试或调整问题。"
    log("assistant", `<final>${fallback}</final>`)
    return { answer: fallback, logEntries }
}

export * from "@memo/core/types"
export * from "@memo/core/prompt"
export * from "@memo/core/history"
export * from "@memo/core/utils"
export * from "@memo/core/llm/openai"
