import type { TokenUsage } from '@memo/core'
import type { ToolStatus } from './types'

export function safeStringify(input: unknown): string {
    if (typeof input === 'string') return input
    try {
        const serialized = JSON.stringify(input)
        return serialized ?? String(input)
    } catch {
        return String(input)
    }
}

export function inferToolStatus(observation?: string): ToolStatus {
    if (!observation) return 'success'
    const lowered = observation.toLowerCase()
    if (observation.includes('失败') || lowered.includes('error') || lowered.includes('unknown')) {
        return 'error'
    }
    return 'success'
}

export function formatTokenUsage(usage?: TokenUsage) {
    if (!usage) return 'tokens: -'
    return `Tokens: prompt ${usage.prompt}  completion ${usage.completion}  total ${usage.total}`
}
