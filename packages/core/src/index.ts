/**
 * Agent 核心：基于 ReAct 模式的循环与依赖注入。
 * 尽量保持纯逻辑，依赖通过 AgentDeps 传入，方便在 CLI/UI 层复用或替换。
 */
import { createAgentSession } from "@memo/core/runtime/session"
import type { AgentResult, AgentSessionDeps, AgentSessionOptions } from "@memo/core/types"
export { MAX_STEPS } from "@memo/core/config/constants"

/**
 * 兼容单轮调用的入口。内部创建 Session 并执行单个 Turn，保持原有返回结构。
 */
export async function runAgent(
    question: string,
    deps: AgentSessionDeps,
    options: AgentSessionOptions = {}
): Promise<AgentResult> {
    const session = await createAgentSession(deps, { ...options, mode: options.mode ?? "once" })
    const turnResult = await session.runTurn(question)
    await session.close()
    return { answer: turnResult.finalText, logEntries: turnResult.logEntries }
}

export * from "@memo/core/types"
export * from "@memo/core/runtime/prompt"
export * from "@memo/core/runtime/history"
export * from "@memo/core/utils"
export * from "@memo/core/llm/tokenizer"
export * from "@memo/core/runtime/session"
export * from "@memo/core/llm/openai"
