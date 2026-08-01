import path from 'node:path'
import type { ToolActionStatus } from '@memo/core'
import { TOOL_STATUS, type ToolStatus } from '../types'

const TOOL_ACTION_STATUS_SUCCESS: ToolActionStatus = 'success'
const CURRENT_DIRECTORY = '.'

export function inferToolStatus(resultStatus?: ToolActionStatus): ToolStatus {
    if (!resultStatus) return TOOL_STATUS.SUCCESS
    return resultStatus === TOOL_ACTION_STATUS_SUCCESS ? TOOL_STATUS.SUCCESS : TOOL_STATUS.ERROR
}

export function inferParallelToolStatuses(parallelResultStatuses?: ToolActionStatus[]): ToolStatus[] | undefined {
    if (!parallelResultStatuses?.length) return undefined
    return parallelResultStatuses.map((status) => inferToolStatus(status))
}

export function calculateContextPercent(currentTokens: number, contextLimit: number): number {
    if (!contextLimit || contextLimit <= 0) return 0
    if (!currentTokens || currentTokens <= 0) return 0
    return Math.min(100, (currentTokens / contextLimit) * 100)
}

export function truncate(input: string, max = 80): string {
    if (input.length <= max) return input
    return `${input.slice(0, Math.max(0, max - 3))}...`
}

export function safeStringify(value: unknown): string {
    if (typeof value === 'string') return value
    try {
        const serialized = JSON.stringify(value)
        return serialized ?? String(value)
    } catch {
        return String(value)
    }
}

export function toRelativeDisplayPath(rawPath: string, cwd: string): string {
    const value = rawPath.trim()
    if (!value) return rawPath
    if (value === CURRENT_DIRECTORY) return CURRENT_DIRECTORY

    if (path.isAbsolute(value)) {
        const relative = path.relative(path.resolve(cwd), value)
        return relative ? path.normalize(relative) : CURRENT_DIRECTORY
    }

    if (value.startsWith('./') || value.startsWith('../')) {
        const normalized = path.normalize(value)
        if (!normalized || normalized === '.' || normalized === './') {
            return CURRENT_DIRECTORY
        }
        return normalized
    }

    return value
}

export function looksLikePathInput(value: string): boolean {
    if (!value) return false
    if (value === CURRENT_DIRECTORY) return true
    if (path.isAbsolute(value)) return true
    return value.startsWith('./') || value.startsWith('../')
}
