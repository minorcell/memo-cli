import { memo, useMemo } from 'react'
import { Box, Text, useStdout } from 'ink'
import stringWidth from 'string-width'
import { table as formatTable } from 'table'
import { parseInlineNodes, parseMarkdownContent, type InlineNode, type MarkdownBlock } from './markdownParser'

const HORIZONTAL_RULE_TEXT = '─'.repeat(60)
const CODE_BLOCK_BACKGROUND = '#1c212b'
const TABLE_MAX_COL_WIDTH = 40

function formatThinkDisplayLines(content: string): string[] {
    const lines = content.split('\n')
    if (lines.length === 0) return ['Think:']

    let firstIndex = lines.findIndex((line) => line.trim().length > 0)
    if (firstIndex < 0) firstIndex = 0

    return lines.map((line, index) => {
        if (index === firstIndex) {
            return `Think: ${line}`
        }
        return line
    })
}

function formatCodeBlockLines(content: string): string[] {
    return content.split('\n')
}

function headingUnderline(content: string): string {
    const width = Math.max(1, Math.min(stringWidth(content), 60))
    return '─'.repeat(width)
}

function CodeBlock({ language, content }: { language?: string; content: string }) {
    const lines = formatCodeBlockLines(content)
    return (
        <Box flexDirection="column" backgroundColor={CODE_BLOCK_BACKGROUND} paddingX={1}>
            {language ? (
                <Text color="gray" dimColor>
                    {language}
                </Text>
            ) : null}
            {lines.map((line, index) => (
                <Text key={index}>{line || ' '}</Text>
            ))}
        </Box>
    )
}

function InlineSegment({ node }: { node: InlineNode }) {
    switch (node.type) {
        case 'bold':
            return <Text bold>{node.content}</Text>
        case 'italic':
            return <Text italic>{node.content}</Text>
        case 'inlineCode':
            return <Text color="cyan">{node.content}</Text>
        case 'link':
            return (
                <>
                    <Text color="blue" underline>
                        {node.label}
                    </Text>
                    <Text color="gray"> ({node.href})</Text>
                </>
            )
        case 'text':
            return <Text>{node.content}</Text>
        default:
            return null
    }
}

function InlineLine({ content }: { content: string }) {
    const inlineNodes = parseInlineNodes(content)
    return (
        <Text wrap="wrap">
            {inlineNodes.map((node, index) => (
                <InlineSegment key={index} node={node} />
            ))}
        </Text>
    )
}

function HeadingBlock({ level, content }: { level: number; content: string }) {
    if (level === 1) {
        return (
            <Box flexDirection="column">
                <Text bold color="cyan">
                    {content}
                </Text>
                <Text color="gray" dimColor>
                    {headingUnderline(content)}
                </Text>
            </Box>
        )
    }
    if (level === 2) {
        return (
            <Text bold color="blue">
                {content}
            </Text>
        )
    }
    return <Text bold>{content}</Text>
}

function ListBlock({ ordered, items }: { ordered: boolean; items: { depth: number; text: string }[] }) {
    const counters = new Map<number, number>()
    const numberFor = (depth: number): number => {
        const deeper = Array.from(counters.keys()).filter((key) => key > depth)
        for (const key of deeper) counters.delete(key)
        const next = (counters.get(depth) ?? 0) + 1
        counters.set(depth, next)
        return next
    }

    return (
        <Box flexDirection="column">
            {items.map((item, index) => {
                const bullet = ordered ? `${numberFor(item.depth)}.` : '•'
                return (
                    <Box key={index} flexDirection="row" paddingLeft={item.depth * 2}>
                        <Text color="gray">{bullet} </Text>
                        <Box flexShrink={1}>
                            <InlineLine content={item.text} />
                        </Box>
                    </Box>
                )
            })}
        </Box>
    )
}

function truncateCell(text: string, width: number): string {
    if (stringWidth(text) <= width) return text
    let out = ''
    let used = 0
    for (const ch of text) {
        const charWidth = stringWidth(ch)
        if (used + charWidth > width - 1) break
        out += ch
        used += charWidth
    }
    return `${out}…`
}

const TABLE_BORDER = {
    topBody: '─',
    topJoin: '┬',
    topLeft: '┌',
    topRight: '┐',
    bottomBody: '─',
    bottomJoin: '┴',
    bottomLeft: '└',
    bottomRight: '┘',
    bodyJoin: '│',
    bodyLeft: '│',
    bodyRight: '│',
    joinBody: '─',
    joinJoin: '┼',
    joinLeft: '├',
    joinRight: '┤',
}

function TableBlock({ header, rows }: { header: string[]; rows: string[][] }) {
    const { stdout } = useStdout()
    const terminalWidth = stdout?.columns ?? process.stdout?.columns ?? 80
    // Frame: one leading and one trailing border column plus two padding chars per cell.
    const frameWidth = 2 * header.length + 2
    const contentBudget = Math.max(1, terminalWidth - frameWidth)

    const naturalWidths = header.map((_, column) => {
        const allRows = [header, ...rows]
        const widest = Math.max(...allRows.map((row) => stringWidth(row[column] ?? '')))
        return Math.max(1, Math.min(widest, TABLE_MAX_COL_WIDTH))
    })

    // Shrink the widest column until the table fits the terminal.
    const widths = [...naturalWidths]
    while (widths.reduce((sum, width) => sum + width, 0) > contentBudget && widths.some((width) => width > 1)) {
        const widestIndex = widths.indexOf(Math.max(...widths))
        widths[widestIndex] = (widths[widestIndex] ?? 1) - 1
    }

    // NOTE: keep cells plain text. The table library measures cells with
    // string-width, which counts ANSI escape sequences as visible width and
    // breaks alignment and truncation for styled cells.
    const data = [
        header.map((cell, column) => truncateCell(cell, widths[column] ?? 1)),
        ...rows.map((row) => row.map((cell, column) => truncateCell(cell, widths[column] ?? 1))),
    ]

    const lines = formatTable(data, {
        border: TABLE_BORDER,
        columnDefault: { paddingLeft: 1, paddingRight: 1 },
        drawHorizontalLine: (index, size) => index === 0 || index === 1 || index === size,
    })

    return (
        <Box flexDirection="column">
            {lines.split('\n').map((line, index) => (
                <Text key={index}>{line || ' '}</Text>
            ))}
        </Box>
    )
}

function BlockquoteBlock({ content }: { content: string }) {
    return (
        <Box flexDirection="column">
            {content.split('\n').map((line, index) => (
                <Box key={index} flexDirection="row">
                    <Text color="gray" dimColor>
                        {'│ '}
                    </Text>
                    <Box flexShrink={1}>
                        <InlineLine content={line} />
                    </Box>
                </Box>
            ))}
        </Box>
    )
}

function renderBlock(node: MarkdownBlock, key: string) {
    switch (node.type) {
        case 'html': {
            return (
                <Box key={key}>
                    <Text color="gray" dimColor>
                        {node.content}
                    </Text>
                </Box>
            )
        }
        case 'hr': {
            return (
                <Box key={key} marginY={1}>
                    <Text color="gray" dimColor>
                        {HORIZONTAL_RULE_TEXT}
                    </Text>
                </Box>
            )
        }
        case 'think': {
            return (
                <Box key={key} flexDirection="column" marginY={1}>
                    {formatThinkDisplayLines(node.content).map((line, index) => (
                        <Text key={index} color="gray" dimColor>
                            {line}
                        </Text>
                    ))}
                </Box>
            )
        }
        case 'heading': {
            return <HeadingBlock key={key} level={node.level} content={node.content} />
        }
        case 'paragraph': {
            return <InlineLine key={key} content={node.content} />
        }
        case 'code': {
            return <CodeBlock key={key} language={node.language} content={node.content} />
        }
        case 'blockquote': {
            return <BlockquoteBlock key={key} content={node.content} />
        }
        case 'list': {
            return <ListBlock key={key} ordered={node.ordered} items={node.items} />
        }
        case 'table': {
            return <TableBlock key={key} header={node.header} rows={node.rows} />
        }
        default:
            return null
    }
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
    const nodes = useMemo(() => parseMarkdownContent(content), [content])

    return (
        <Box flexDirection="column">
            {nodes.map((node, index) => {
                const block = renderBlock(node, `${node.type}-${index}`)
                if (index === 0 || node.type === 'hr' || node.type === 'think') {
                    return block
                }
                return (
                    <Box key={`spacer-${index}`} marginTop={1}>
                        {block}
                    </Box>
                )
            })}
        </Box>
    )
})

export const MARKDOWN_RENDERER_TEST_EXPORTS = {
    HORIZONTAL_RULE_TEXT,
    formatCodeBlockLines,
    formatThinkDisplayLines,
}
