import assert from 'node:assert'
import { describe, test } from 'vitest'
import { MARKDOWN_TEST_EXPORTS, parseInlineNodes, parseMarkdownContent } from './markdownParser'

describe('markdown parser', () => {
    test('extracts think blocks and strips them from markdown', () => {
        const source = `before\n<think>hidden reasoning</think>\nafter`
        const parsed = MARKDOWN_TEST_EXPORTS.extractThinkSections(source)

        assert.deepStrictEqual(parsed.think, ['hidden reasoning'])
        assert.ok(!parsed.cleaned.includes('<think>'))
        assert.ok(parsed.cleaned.includes('before'))
        assert.ok(parsed.cleaned.includes('after'))
    })

    test('parses inline styles and link segments', () => {
        const nodes = parseInlineNodes('plain **bold** *italic* `code` [memo](https://memo.example)')
        const kinds = nodes.map((node) => node.type)

        assert.deepStrictEqual(kinds, ['text', 'bold', 'text', 'italic', 'text', 'inlineCode', 'text', 'link'])
        const link = nodes.find((node) => node.type === 'link')
        assert.ok(link)
        if (link?.type === 'link') {
            assert.strictEqual(link.label, 'memo')
            assert.strictEqual(link.href, 'https://memo.example')
        }
    })

    test('parses heading, blockquote, list, code and hr blocks', () => {
        const markdown = [
            '# Title',
            '',
            '> quoted line',
            '',
            '- item one',
            '- item two',
            '',
            '```ts',
            'const x = 1',
            '```',
            '',
            '---',
        ].join('\n')

        const blocks = parseMarkdownContent(markdown)
        const kinds = blocks.map((node) => node.type)

        assert.ok(kinds.includes('heading'))
        assert.ok(kinds.includes('blockquote'))
        assert.ok(kinds.includes('list'))
        assert.ok(kinds.includes('code'))
        assert.ok(kinds.includes('hr'))
    })
})
