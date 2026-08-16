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

    test('parses nested lists with depth levels', () => {
        const markdown = ['- top one', '  - nested a', '  - nested b', '- top two', '  - nested c'].join('\n')

        const blocks = parseMarkdownContent(markdown)
        assert.deepStrictEqual(blocks, [
            {
                type: 'list',
                ordered: false,
                items: [
                    { depth: 0, text: 'top one' },
                    { depth: 1, text: 'nested a' },
                    { depth: 1, text: 'nested b' },
                    { depth: 0, text: 'top two' },
                    { depth: 1, text: 'nested c' },
                ],
            },
        ])
    })

    test('parses tables into header and rows', () => {
        const markdown = ['| Name | Value |', '| ---- | ----- |', '| a    | 1     |', '| b    | 2     |'].join('\n')

        const blocks = parseMarkdownContent(markdown)
        assert.deepStrictEqual(blocks, [
            {
                type: 'table',
                header: ['Name', 'Value'],
                rows: [
                    ['a', '1'],
                    ['b', '2'],
                ],
            },
        ])
    })

    test('parses incomplete fenced code during streaming', () => {
        const blocks = parseMarkdownContent('```ts\nconst value = 1')

        assert.deepStrictEqual(blocks, [{ type: 'code', language: 'ts', content: 'const value = 1' }])
    })

    test('upgrades incomplete emphasis when the closing marker arrives', () => {
        assert.deepStrictEqual(parseInlineNodes('streaming **bold'), [{ type: 'text', content: 'streaming **bold' }])
        assert.deepStrictEqual(parseInlineNodes('streaming **bold**'), [
            { type: 'text', content: 'streaming ' },
            { type: 'bold', content: 'bold' },
        ])
    })
})
