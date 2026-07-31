/** @file Session lifecycle Hook aggregation and execution helpers for unified extension. */
import type {
    ActionHookPayload,
    AgentHookHandler,
    AgentMiddleware,
    AgentSessionDeps,
    ChatMessage,
    ContextCompactedHookPayload,
    ContextUsageHookPayload,
    FinalHookPayload,
    ObservationHookPayload,
    TurnStartHookPayload,
    ApprovalHookPayload,
    ApprovalResponseHookPayload,
    TitleGeneratedHookPayload,
} from '@memo/core/types'

export type HookName =
    | 'onTurnStart'
    | 'onContextUsage'
    | 'onContextCompacted'
    | 'onAction'
    | 'onObservation'
    | 'onFinal'
    | 'onApprovalRequest'
    | 'onApprovalResponse'
    | 'onTitleGenerated'

export type HookPayloadMap = {
    onTurnStart: TurnStartHookPayload
    onContextUsage: ContextUsageHookPayload
    onContextCompacted: ContextCompactedHookPayload
    onAction: ActionHookPayload
    onObservation: ObservationHookPayload
    onFinal: FinalHookPayload
    onApprovalRequest: ApprovalHookPayload
    onApprovalResponse: ApprovalResponseHookPayload
    onTitleGenerated: TitleGeneratedHookPayload
}

export type HookRunnerMap = {
    [K in HookName]: AgentHookHandler<HookPayloadMap[K]>[]
}

function emptyHookMap(): HookRunnerMap {
    return {
        onTurnStart: [],
        onContextUsage: [],
        onContextCompacted: [],
        onAction: [],
        onObservation: [],
        onFinal: [],
        onApprovalRequest: [],
        onApprovalResponse: [],
        onTitleGenerated: [],
    }
}

function registerMiddleware(target: HookRunnerMap, middleware?: AgentMiddleware) {
    if (!middleware) return
    if (middleware.onTurnStart) target.onTurnStart.push(middleware.onTurnStart)
    if (middleware.onContextUsage) target.onContextUsage.push(middleware.onContextUsage)
    if (middleware.onContextCompacted) {
        target.onContextCompacted.push(middleware.onContextCompacted)
    }
    if (middleware.onAction) target.onAction.push(middleware.onAction)
    if (middleware.onObservation) target.onObservation.push(middleware.onObservation)
    if (middleware.onFinal) target.onFinal.push(middleware.onFinal)
    if (middleware.onApprovalRequest) target.onApprovalRequest.push(middleware.onApprovalRequest)
    if (middleware.onApprovalResponse) target.onApprovalResponse.push(middleware.onApprovalResponse)
    if (middleware.onTitleGenerated) target.onTitleGenerated.push(middleware.onTitleGenerated)
}

export function buildHookRunners(deps: AgentSessionDeps): HookRunnerMap {
    const map = emptyHookMap()
    registerMiddleware(map, deps.hooks)
    if (Array.isArray(deps.middlewares)) {
        for (const middleware of deps.middlewares) {
            registerMiddleware(map, middleware)
        }
    }
    return map
}

export async function runHook<K extends HookName>(map: HookRunnerMap, name: K, payload: HookPayloadMap[K]) {
    const handlers = map[name]
    if (!handlers.length) return
    for (const handler of handlers) {
        try {
            await handler(payload)
        } catch (err) {
            console.warn(`Hook ${name} failed: ${(err as Error).message}`)
        }
    }
}

export function snapshotHistory(history: ChatMessage[]): ChatMessage[] {
    return history.map((msg) => {
        if (msg.role === 'assistant' && msg.tool_calls?.length) {
            return {
                ...msg,
                tool_calls: msg.tool_calls.map((toolCall) => ({
                    ...toolCall,
                    function: { ...toolCall.function },
                })),
            }
        }
        return { ...msg }
    })
}
