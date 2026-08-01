/** @file Error classification helpers. */

export function isAbortError(err: unknown): err is Error {
    if (!(err instanceof Error)) return false
    if (err.name === 'AbortError') return true

    const message = err.message?.toLowerCase?.() ?? ''
    return (
        message.includes('request was aborted') ||
        message.includes('operation was aborted') ||
        message.includes('aborted')
    )
}
