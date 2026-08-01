/** @file Session title helpers. */

export const SESSION_TITLE_MAX_CHARS = 60

export function truncateSessionTitle(input: string): string {
    if (input.length <= SESSION_TITLE_MAX_CHARS) return input
    return `${input.slice(0, SESSION_TITLE_MAX_CHARS - 3).trimEnd()}...`
}

export function normalizeSessionTitle(raw: string): string {
    const compact = raw
        .replace(/<\s*(think|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
        .replace(/<\s*\/?\s*(think|thinking)\b[^>]*>/gi, ' ')
        .replace(/\r?\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (!compact) return ''
    const unprefixed = compact.replace(/^(title|session title|标题)\s*[:：-]\s*/i, '').trim()
    if (!unprefixed) return ''
    const unquoted = unprefixed.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim()
    if (!unquoted) return ''
    return truncateSessionTitle(unquoted)
}

export function fallbackSessionTitleFromPrompt(input: string): string {
    const compact = input.replace(/\s+/g, ' ').trim()
    if (!compact) return 'New Session'

    // Keep short CJK/non-space prompts readable.
    if (!compact.includes(' ')) {
        return compact.length <= 20 ? compact : `${compact.slice(0, 20).trimEnd()}...`
    }

    const words = compact.split(' ').filter(Boolean)
    const short = words.slice(0, 8).join(' ')
    return truncateSessionTitle(short || compact)
}
