import { marked } from 'marked'

export type InlineNode =
    | { type: 'text'; content: string }
    | { type: 'bold'; content: string }
    | { type: 'italic'; content: string }
    | { type: 'inlineCode'; content: string }
    | { type: 'link'; label: string; href: string }

export type ListItem = { depth: number; text: string }

export type MarkdownBlock =
    | { type: 'think'; content: string }
    | { type: 'heading'; level: number; content: string }
    | { type: 'paragraph'; content: string }
    | { type: 'code'; language?: string; content: string }
    | { type: 'blockquote'; content: string }
    | { type: 'list'; items: ListItem[]; ordered: boolean }
    | { type: 'table'; header: string[]; rows: string[][] }
    | { type: 'hr' }
    | { type: 'html'; content: string }

const INLINE_TOKEN_PATTERN =
    /(`[^`\n]+`|\[[^\]]+\]\((?:\\.|[^)])+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g

function extractTextFromInlineTokens(tokens: unknown[]): string {
    return tokens
        .map((token) => {
            const item = token as {
                raw?: string
                text?: string
                tokens?: unknown[]
                items?: Array<{ text?: string; tokens?: unknown[] }>
            }
            if (typeof item.text === 'string') return item.text
            if (typeof item.raw === 'string') return item.raw
            if (Array.isArray(item.tokens)) return extractTextFromInlineTokens(item.tokens)
            if (Array.isArray(item.items)) {
                return item.items
                    .map((child) => {
                        if (typeof child.text === 'string') return child.text
                        if (Array.isArray(child.tokens)) return extractTextFromInlineTokens(child.tokens)
                        return ''
                    })
                    .filter(Boolean)
                    .join('\n')
            }
            return ''
        })
        .join('')
}

function extractThinkSections(markdown: string): { think: string[]; cleaned: string } {
    const think: string[] = []
    const cleaned = markdown.replace(/<think>([\s\S]*?)<\/think>/gi, (_, content: string) => {
        const trimmed = content.trim()
        if (trimmed) think.push(trimmed)
        return ''
    })
    return { think, cleaned }
}

function parseInlineNodeToken(token: string): InlineNode {
    if (token.startsWith('`') && token.endsWith('`')) {
        return { type: 'inlineCode', content: token.slice(1, -1) }
    }

    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
        return { type: 'bold', content: token.slice(2, -2) }
    }

    if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
        return { type: 'italic', content: token.slice(1, -1) }
    }

    const linkMatch = token.match(/^\[([^\]]+)\]\((.+)\)$/)
    if (linkMatch) {
        return { type: 'link', label: linkMatch[1] ?? '', href: linkMatch[2] ?? '' }
    }

    return { type: 'text', content: token }
}

export function parseInlineNodes(text: string): InlineNode[] {
    if (!text) return []

    const nodes: InlineNode[] = []
    let lastIndex = 0

    for (const match of text.matchAll(INLINE_TOKEN_PATTERN)) {
        const token = match[0]
        if (!token) continue

        const index = match.index ?? 0
        if (index > lastIndex) {
            nodes.push({ type: 'text', content: text.slice(lastIndex, index) })
        }

        nodes.push(parseInlineNodeToken(token))
        lastIndex = index + token.length
    }

    if (lastIndex < text.length) {
        nodes.push({ type: 'text', content: text.slice(lastIndex) })
    }

    return nodes.filter((node) => {
        if (node.type === 'link') {
            return node.label.length > 0 || node.href.length > 0
        }
        return node.content.length > 0
    })
}

function parseListItemText(item: { text?: string; tokens?: Array<{ type?: string }> }): string {
    const ownTokens = (item.tokens ?? []).filter((token) => token.type !== 'list')
    if (ownTokens.length > 0) {
        const own = extractTextFromInlineTokens(ownTokens)
        if (own.trim().length > 0) return own
    }
    if (typeof item.text === 'string' && item.text.length > 0) {
        // When the item nests a sublist, item.text spans multiple lines;
        // the first line is the item's own text.
        return item.text.split('\n')[0] ?? ''
    }
    return ''
}

type MarkedListItem = { text?: string; tokens?: Array<{ type?: string; items?: MarkedListItem[] }> }

function flattenListItems(items: MarkedListItem[], depth: number): ListItem[] {
    const flat: ListItem[] = []
    for (const item of items) {
        const text = parseListItemText(item)
        if (text.trim().length > 0) {
            flat.push({ depth, text })
        }
        for (const token of item.tokens ?? []) {
            if (token.type === 'list' && Array.isArray(token.items)) {
                flat.push(...flattenListItems(token.items, depth + 1))
            }
        }
    }
    return flat
}

function extractCellText(cell: { text?: string; tokens?: unknown[]; raw?: string }): string {
    if (typeof cell.text === 'string') return cell.text
    if (Array.isArray(cell.tokens)) return extractTextFromInlineTokens(cell.tokens)
    if (typeof cell.raw === 'string') return cell.raw
    return ''
}

function parseBlockquoteText(token: { text?: string; tokens?: unknown[]; raw?: string }): string {
    if (typeof token.text === 'string' && token.text.length > 0) {
        return token.text
    }
    if (Array.isArray(token.tokens)) {
        return extractTextFromInlineTokens(token.tokens)
    }
    if (typeof token.raw === 'string') {
        return token.raw
            .split('\n')
            .map((line) => line.replace(/^>\s?/, ''))
            .join('\n')
            .trim()
    }
    return ''
}

function parseParagraphText(token: { text?: string; tokens?: unknown[]; raw?: string }): string {
    if (typeof token.text === 'string') return token.text
    if (Array.isArray(token.tokens)) return extractTextFromInlineTokens(token.tokens)
    if (typeof token.raw === 'string') return token.raw
    return ''
}

export function parseMarkdownContent(markdown: string): MarkdownBlock[] {
    const { think, cleaned } = extractThinkSections(markdown)
    const nodes: MarkdownBlock[] = []

    if (think.length > 0) {
        nodes.push({ type: 'think', content: think.join('\n\n') })
    }

    const tokens = marked.lexer(cleaned)
    for (const token of tokens as Array<any>) {
        switch (token.type) {
            case 'html': {
                nodes.push({ type: 'html', content: token.text ?? token.raw ?? '' })
                break
            }
            case 'hr': {
                nodes.push({ type: 'hr' })
                break
            }
            case 'heading': {
                nodes.push({
                    type: 'heading',
                    level: typeof token.depth === 'number' ? token.depth : 1,
                    content: token.text ?? parseParagraphText(token),
                })
                break
            }
            case 'paragraph':
            case 'text': {
                const content = parseParagraphText(token)
                if (content.trim().length > 0) {
                    nodes.push({ type: 'paragraph', content })
                }
                break
            }
            case 'code': {
                nodes.push({ type: 'code', language: token.lang, content: token.text ?? '' })
                break
            }
            case 'blockquote': {
                const content = parseBlockquoteText(token)
                if (content.trim().length > 0) {
                    nodes.push({ type: 'blockquote', content })
                }
                break
            }
            case 'list': {
                const items = Array.isArray(token.items) ? flattenListItems(token.items, 0) : []
                if (items.length > 0) {
                    nodes.push({ type: 'list', items, ordered: Boolean(token.ordered) })
                }
                break
            }
            case 'table': {
                const header = Array.isArray(token.header)
                    ? token.header.map((cell: { text?: string; tokens?: unknown[]; raw?: string }) =>
                          extractCellText(cell),
                      )
                    : []
                const rows = Array.isArray(token.rows)
                    ? token.rows.map((row: unknown[]) =>
                          Array.isArray(row)
                              ? row.map((cell) =>
                                    extractCellText(cell as { text?: string; tokens?: unknown[]; raw?: string }),
                                )
                              : [],
                      )
                    : []
                if (header.length > 0) {
                    nodes.push({ type: 'table', header, rows })
                }
                break
            }
            default:
                break
        }
    }

    return nodes
}

export const MARKDOWN_TEST_EXPORTS = {
    extractThinkSections,
}
