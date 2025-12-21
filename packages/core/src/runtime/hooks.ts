/** @file Session 生命周期 Hook 聚合与运行辅助，方便统一扩展。 */
import type {
    ActionHookPayload,
    AgentHookHandler,
    AgentMiddleware,
    AgentSessionDeps,
    ChatMessage,
    FinalHookPayload,
    ObservationHookPayload,
    TurnStartHookPayload,
} from '@memo/core/types'

export type HookName = 'onTurnStart' | 'onAction' | 'onObservation' | 'onFinal'

export type HookPayloadMap = {
    onTurnStart: TurnStartHookPayload
    onAction: ActionHookPayload
    onObservation: ObservationHookPayload
    onFinal: FinalHookPayload
}

export type HookRunnerMap = {
    [K in HookName]: AgentHookHandler<HookPayloadMap[K]>[]
}

function emptyHookMap(): HookRunnerMap {
    return {
        onTurnStart: [],
        onAction: [],
        onObservation: [],
        onFinal: [],
    }
}

function registerMiddleware(target: HookRunnerMap, middleware?: AgentMiddleware) {
    if (!middleware) return
    if (middleware.onTurnStart) target.onTurnStart.push(middleware.onTurnStart)
    if (middleware.onAction) target.onAction.push(middleware.onAction)
    if (middleware.onObservation) target.onObservation.push(middleware.onObservation)
    if (middleware.onFinal) target.onFinal.push(middleware.onFinal)
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

export async function runHook<K extends HookName>(
    map: HookRunnerMap,
    name: K,
    payload: HookPayloadMap[K],
) {
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
    return history.map((msg) => ({ ...msg }))
}
