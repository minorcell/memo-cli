import { Box, Text } from 'ink'
import { marked } from 'marked'
import type { ReactNode } from 'react'
import type { Token, Tokens, TokensList } from 'marked'

type MarkdownMessageProps = {
    text: string
    tone?: 'normal' | 'muted'
}

type RenderPalette = {
    textColor?: string
    codeColor: string
    linkColor: string
    muted: boolean
}

const INLINE_CODE_BACKGROUND = '#2b2b2b'

function inlineTokensFromText(text: string): Token[] {
    if (!text) return []
    return [
        {
            type: 'text',
            raw: text,
            text,
        } as Tokens.Text,
    ]
}

function renderInlineToken(
    token: Token,
    palette: RenderPalette,
    key: string,
): ReactNode | ReactNode[] {
    switch (token.type) {
        case 'text': {
            if (token.tokens && token.tokens.length > 0) {
                return renderInlineTokens(token.tokens, palette, `${key}-text`)
            }
            return token.text
        }
        case 'escape':
            return token.text
        case 'strong':
            return (
                <Text key={key} bold>
                    {renderInlineTokens(token.tokens, palette, `${key}-strong`)}
                </Text>
            )
        case 'em':
            return (
                <Text key={key} italic>
                    {renderInlineTokens(token.tokens, palette, `${key}-em`)}
                </Text>
            )
        case 'codespan':
            return (
                <Text
                    key={key}
                    color={palette.codeColor}
                    backgroundColor={INLINE_CODE_BACKGROUND}
                >
                    {token.text}
                </Text>
            )
        case 'del':
            return (
                <Text key={key} strikethrough>
                    {renderInlineTokens(token.tokens, palette, `${key}-del`)}
                </Text>
            )
        case 'link': {
            const label =
                token.tokens && token.tokens.length > 0
                    ? renderInlineTokens(token.tokens, palette, `${key}-link`)
                    : token.text
            const suffix =
                token.href && token.text && token.text !== token.href
                    ? ` (${token.href})`
                    : ''
            return (
                <Text key={key} underline color={palette.linkColor}>
                    {label}
                    {suffix}
                </Text>
            )
        }
        case 'image': {
            const altText = token.text || 'image'
            return (
                <Text key={key} color={palette.linkColor}>
                    [{altText}]({token.href})
                </Text>
            )
        }
        case 'br':
            return '\n'
        case 'checkbox':
            return token.checked ? '[x]' : '[ ]'
        case 'html':
            return token.text
        default:
            return 'text' in token ? token.text : token.raw
    }
}

function renderInlineTokens(
    tokens: Token[] | undefined,
    palette: RenderPalette,
    keyPrefix: string,
): ReactNode[] {
    if (!tokens || tokens.length === 0) return []
    return tokens.flatMap((token, index) => {
        const key = `${keyPrefix}-${index}`
        const rendered = renderInlineToken(token, palette, key)
        return Array.isArray(rendered) ? rendered : [rendered]
    })
}

function listItemInlineTokens(item: Tokens.ListItem): Token[] {
    const firstToken = item.tokens[0]
    if (firstToken?.type === 'paragraph' || firstToken?.type === 'text') {
        return firstToken.tokens ?? inlineTokensFromText(firstToken.text)
    }
    return item.tokens.length > 0 ? item.tokens : inlineTokensFromText(item.text)
}

function formatCodeBlock(text: string): string {
    return text
        .split('\n')
        .map((line) => (line.length > 0 ? `  ${line}` : ''))
        .join('\n')
        .trimEnd()
}

function renderTable(token: Tokens.Table): string {
    const header = token.header.map((cell) => cell.text).join(' | ')
    const separator = token.header.map(() => '---').join(' | ')
    const rows = token.rows.map((row) => row.map((cell) => cell.text).join(' | '))
    return [header, separator, ...rows].join('\n')
}

function isTableToken(token: Token): token is Tokens.Table {
    return (
        token.type === 'table' &&
        'header' in token &&
        'rows' in token &&
        'align' in token
    )
}

function renderBlockToken(
    token: Token,
    palette: RenderPalette,
    key: string,
): ReactNode | null {
    switch (token.type) {
        case 'space':
        case 'def':
            return null
        case 'heading':
            return (
                <Text key={key} bold color={palette.textColor}>
                    {renderInlineTokens(token.tokens, palette, `${key}-heading`)}
                </Text>
            )
        case 'paragraph': {
            const inlineTokens = token.tokens ?? inlineTokensFromText(token.text)
            return (
                <Text key={key} color={palette.textColor}>
                    {renderInlineTokens(inlineTokens, palette, `${key}-para`)}
                </Text>
            )
        }
        case 'text': {
            const inlineTokens = token.tokens ?? inlineTokensFromText(token.text)
            return (
                <Text key={key} color={palette.textColor}>
                    {renderInlineTokens(inlineTokens, palette, `${key}-text`)}
                </Text>
            )
        }
        case 'code': {
            const codeText = formatCodeBlock(token.text)
            return (
                <Text key={key} color={palette.codeColor}>
                    {codeText}
                </Text>
            )
        }
        case 'list': {
            const startIndex = typeof token.start === 'number' ? token.start : 1
            return (
                <Box key={key} flexDirection="column">
                    {token.items.map((item: Tokens.ListItem, index: number) => {
                        const bullet = token.ordered
                            ? `${startIndex + index}.`
                            : '-'
                        const taskPrefix = item.task
                            ? item.checked
                                ? '[x] '
                                : '[ ] '
                            : ''
                        const inlineTokens = listItemInlineTokens(item)
                        return (
                            <Box key={`${key}-item-${index}`}>
                                <Text color={palette.textColor}>{bullet} </Text>
                                <Text color={palette.textColor}>
                                    {taskPrefix}
                                    {renderInlineTokens(
                                        inlineTokens,
                                        palette,
                                        `${key}-item-${index}`,
                                    )}
                                </Text>
                            </Box>
                        )
                    })}
                </Box>
            )
        }
        case 'blockquote':
            return (
                <Text key={key} color="gray" dimColor>
                    &gt; {token.text.trim()}
                </Text>
            )
        case 'hr':
            return (
                <Text key={key} color="gray">
                    ---
                </Text>
            )
        case 'table':
            return isTableToken(token) ? (
                <Text key={key} color={palette.textColor}>
                    {renderTable(token)}
                </Text>
            ) : (
                <Text key={key} color={palette.textColor}>
                    {'text' in token ? token.text : token.raw}
                </Text>
            )
        case 'html':
            return (
                <Text key={key} color={palette.textColor}>
                    {token.text}
                </Text>
            )
        default:
            return (
                <Text key={key} color={palette.textColor}>
                    {'text' in token ? token.text : token.raw}
                </Text>
            )
    }
}

function renderBlocks(
    tokens: TokensList,
    palette: RenderPalette,
    keyPrefix: string,
): ReactNode[] {
    return tokens.flatMap((token, index) => {
        const rendered = renderBlockToken(token, palette, `${keyPrefix}-${index}`)
        return rendered ? [rendered] : []
    })
}

export function MarkdownMessage({ text, tone = 'normal' }: MarkdownMessageProps) {
    const palette: RenderPalette = {
        textColor: tone === 'muted' ? 'gray' : undefined,
        codeColor: tone === 'muted' ? 'gray' : 'cyan',
        linkColor: tone === 'muted' ? 'gray' : 'blue',
        muted: tone === 'muted',
    }
    const tokens = marked.lexer(text, { gfm: true, breaks: true })
    const blocks = renderBlocks(tokens, palette, 'markdown')

    return <Box flexDirection="column" gap={1}>{blocks}</Box>
}
