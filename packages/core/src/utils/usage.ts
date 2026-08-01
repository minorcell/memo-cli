/** @file Token usage aggregation helpers for AI SDK LanguageModelUsage. */
import type { LanguageModelUsage } from 'ai'

export function emptyUsage(): LanguageModelUsage {
    return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    }
}

export function accumulateUsage(target: LanguageModelUsage, delta?: Partial<LanguageModelUsage>) {
    if (!delta) return
    const inputDelta = delta.inputTokens ?? 0
    const outputDelta = delta.outputTokens ?? 0
    const totalDelta = delta.totalTokens ?? inputDelta + outputDelta
    target.inputTokens = (target.inputTokens ?? 0) + inputDelta
    target.outputTokens = (target.outputTokens ?? 0) + outputDelta
    target.totalTokens = (target.totalTokens ?? 0) + totalDelta
}
