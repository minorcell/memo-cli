import type { ResolvedSessionDeps } from '@memo/core/agent/defaults'
import { AgentSessionImpl } from '@memo/core/agent/loop'
import type { CollabSessionBinding } from '@memo/core/agent/control'
import type { AgentSession, AgentSessionDeps, AgentSessionOptions, ChatMessage, HistorySink } from '@memo/core/types'

export async function createSubagentSession(params: {
    deps: ResolvedSessionDeps
    rootDeps: AgentSessionDeps
    options: AgentSessionOptions
    sessionId: string
    systemPrompt: string
    initialHistory: ChatMessage[]
    binding: CollabSessionBinding
    statusSink: HistorySink
}): Promise<AgentSession> {
    const childHistory = params.deps.createChildHistory(params.sessionId)
    const session = new AgentSessionImpl(
        {
            ...params.deps,
            historySinks: [...childHistory.historySinks, params.statusSink],
            requestApproval: params.rootDeps.requestApproval,
            // Shared model/MCP tools are borrowed from the root; only the root owns their disposer.
            dispose: undefined,
        },
        { ...params.options, sessionId: params.sessionId },
        params.systemPrompt,
        params.deps.tokenCounter,
        childHistory.historyFilePath,
        { initialHistory: params.initialHistory, collab: params.binding },
    )
    await session.init()
    return session
}
