import type { ToolResultOutput } from '@ai-sdk/provider-utils'

/** Standard AI SDK tool output shape. */
export type ToolOutput = ToolResultOutput

/** Quick constructor for text-based tool output. */
export function textResult(text: string, isError = false): ToolOutput {
    return isError ? { type: 'error-text', value: text } : { type: 'text', value: text }
}

/** Flatten tool output to string for observation display. */
export function flattenText(result: ToolResultOutput): string {
    if (result.type === 'text' || result.type === 'error-text') return result.value
    if (result.type === 'json' || result.type === 'error-json') return JSON.stringify(result.value)
    if (result.type === 'execution-denied') return result.reason ?? ''
    return '(no tool output)'
}
