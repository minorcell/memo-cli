const DEFAULT_MAX_TOOL_RESULT_CHARS = 20_000
const DEFAULT_MIN_TOOL_RESULT_LINES = 100

function parsePositiveInt(raw: string | undefined): number | null {
    const value = raw?.trim()
    if (!value) return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return Math.floor(parsed)
}

export function getMaxToolResultChars() {
    return parsePositiveInt(process.env.MEMO_TOOL_RESULT_MAX_CHARS) ?? DEFAULT_MAX_TOOL_RESULT_CHARS
}

export function getMaxToolResultLines() {
    return Math.max(DEFAULT_MIN_TOOL_RESULT_LINES, Math.floor(getMaxToolResultChars() / 120))
}
