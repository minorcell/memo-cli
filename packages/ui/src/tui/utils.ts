import type { TokenUsage } from '@memo/core'
import stringWidth from 'string-width'
import type { ToolStatus } from './types'

type ToolCallShape = { tool: string; input?: unknown }

function isToolCallShape(value: unknown): value is ToolCallShape {
    if (!value || typeof value !== 'object') return false
    const record = value as Record<string, unknown>
    return typeof record.tool === 'string'
}

function isToolCallJson(text: string): boolean {
    try {
        const parsed = JSON.parse(text)
        return isToolCallShape(parsed)
    } catch {
        return false
    }
}

export function stripToolCallArtifacts(text: string): string {
    if (!text.trim()) return text
    let output = text

    const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/g
    output = output.replace(fencedRegex, (full, body) => {
        const candidate = typeof body === 'string' ? body.trim() : ''
        if (!candidate.startsWith('{') || !candidate.endsWith('}')) return full
        return isToolCallJson(candidate) ? '' : full
    })

    const trimmed = output.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        if (isToolCallJson(trimmed)) return ''
    }

    return output.replace(/\n{3,}/g, '\n\n').trim()
}

export function buildPaddedLine(content: string, width: number, paddingX = 1) {
    const safeWidth = Math.max(1, width)
    const padded = `${' '.repeat(paddingX)}${content}${' '.repeat(paddingX)}`
    const padding = Math.max(0, safeWidth - stringWidth(padded))
    const line = padding > 0 ? `${padded}${' '.repeat(padding)}` : padded
    return { line, blankLine: ' '.repeat(safeWidth) }
}

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
    if (lowered.includes('error') || lowered.includes('unknown') || lowered.includes('failed')) {
        return 'error'
    }
    return 'success'
}

export function formatTokenUsage(usage?: TokenUsage) {
    if (!usage) return 'tokens: -'
    return `Tokens: prompt ${usage.prompt}  completion ${usage.completion}  total ${usage.total}`
}
