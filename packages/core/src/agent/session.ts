import { randomUUID } from 'node:crypto'
import { withDefaultDeps } from '@memo/core/agent/defaults'
import { DEFAULT_SESSION_MODE } from '@memo/core/agent/constants'
import { AgentSessionImpl } from '@memo/core/agent/loop'
import type { AgentSession, AgentSessionDeps, AgentSessionOptions } from '@memo/core/types'
import { AgentControl } from '@memo/core/agent/control'
import { createSubagentSession } from '@memo/core/agent/subagent'

export { SessionBusyError, SessionClosedError, type SessionOperationKind } from '@memo/core/agent/loop'

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
    const collabEnabled = process.env.MEMO_ENABLE_COLLAB_TOOLS !== '0'
    let control: AgentControl | undefined
    if (collabEnabled) {
        control = new AgentControl({
            rootSessionId: sessionId,
            rootSystemPrompt: systemPrompt,
            rootHistorySinks: resolved.historySinks,
            onAgentActivity: deps.onAgentActivity,
            createSubagent: (params) =>
                createSubagentSession({
                    deps: resolved,
                    rootDeps: deps,
                    options: { ...options, mode: options.mode ?? DEFAULT_SESSION_MODE },
                    sessionId: params.sessionId,
                    systemPrompt: params.systemPrompt,
                    initialHistory: params.initialHistory,
                    binding: params.binding,
                    statusSink: params.statusSink,
                }),
        })
    }
    const collab = control?.createRootBinding()
    const session = new AgentSessionImpl(
        { ...(deps as AgentSessionDeps), ...resolved },
        { ...options, sessionId, mode: options.mode ?? DEFAULT_SESSION_MODE },
        systemPrompt,
        resolved.tokenCounter,
        resolved.historyFilePath,
        { collab },
    )
    await session.init()
    control?.attachRootSession(session)
    return session
}
