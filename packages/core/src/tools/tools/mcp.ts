import type { MemoToolOutput } from '@memo/core/tools/router/types'

/** Quick constructor for text-based tool output. */
export function textResult(text: string, isError = false): MemoToolOutput {
    return isError ? { type: 'error-text', value: text } : { type: 'text', value: text }
}

/** Flatten tool output to string for observation display. */
export function flattenText(result: MemoToolOutput): string {
    if (result.type === 'text' || result.type === 'error-text') return result.value
    if (result.type === 'json') return JSON.stringify(result.value)
    return result.reason ?? ''
}
