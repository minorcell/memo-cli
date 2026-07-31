import { memo, useMemo } from 'react'
import { Box, Text } from 'ink'
import { parseInlineNodes, parseMarkdownContent, type InlineNode, type MarkdownBlock } from './markdownParser'

const HORIZONTAL_RULE_TEXT = '———'

function repeat(str: string, count: number): string {
    return str.repeat(Math.max(0, count))
}

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

function CodeBlock({ content }: { content: string }) {
    const lines = formatCodeBlockLines(content)
    return (
        <Box flexDirection="column" marginY={1}>
            {lines.map((line, index) => (
                <Text key={index}>{line}</Text>
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
        <Box flexWrap="wrap">
            {inlineNodes.map((node, index) => (
                <InlineSegment key={index} node={node} />
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
            return (
                <Box key={key}>
                    <Text bold color="cyan">
                        {repeat('#', node.level)} {node.content}
                    </Text>
                </Box>
            )
        }
        case 'paragraph': {
            return <InlineLine key={key} content={node.content} />
        }
        case 'code': {
            return <CodeBlock key={key} content={node.content} />
        }
        case 'blockquote': {
            return (
                <Box key={key} flexDirection="column">
                    {node.content.split('\n').map((line, index) => (
                        <Box key={index}>
                            <Text color="gray" dimColor>{`> `}</Text>
                            <InlineLine content={line} />
                        </Box>
                    ))}
                </Box>
            )
        }
        case 'list': {
            return (
                <Box key={key} flexDirection="column">
                    {node.items.map((item, index) => (
                        <Box key={index}>
                            <Text color="gray">{node.ordered ? `${index + 1}.` : '•'} </Text>
                            <InlineLine content={item} />
                        </Box>
                    ))}
                </Box>
            )
        }
        default:
            return null
    }
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
    const nodes = useMemo(() => parseMarkdownContent(content), [content])

    return <Box flexDirection="column">{nodes.map((node, index) => renderBlock(node, `${node.type}-${index}`))}</Box>
})

export const MARKDOWN_RENDERER_TEST_EXPORTS = {
    HORIZONTAL_RULE_TEXT,
    formatCodeBlockLines,
    formatThinkDisplayLines,
}
