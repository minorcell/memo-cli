import { randomUUID } from 'node:crypto'
import { withDefaultDeps } from '@memo/core/agent/defaults'
import { DEFAULT_SESSION_MODE } from '@memo/core/agent/constants'
import { AgentSessionImpl } from '@memo/core/agent/loop'
import type { AgentSession, AgentSessionDeps, AgentSessionOptions } from '@memo/core/types'

/**
 * 创建一个 Agent Session，支持多轮对话与 JSONL 事件记录。
 */
export async function createAgentSession(
    deps: AgentSessionDeps,
    options: AgentSessionOptions = {},
): Promise<AgentSession> {
    const sessionId = options.sessionId || randomUUID()
    const resolved = await withDefaultDeps(deps, { ...options, sessionId }, sessionId)
    const systemPrompt = await resolved.loadPrompt()
    const session = new AgentSessionImpl(
        { ...(deps as AgentSessionDeps), ...resolved },
        { ...options, sessionId, mode: options.mode ?? DEFAULT_SESSION_MODE },
        systemPrompt,
        resolved.tokenCounter,
        resolved.historyFilePath,
    )
    await session.init()
    return session
}
