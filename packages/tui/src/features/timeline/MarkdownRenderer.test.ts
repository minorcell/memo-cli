import assert from 'node:assert'
import { describe, test } from 'vitest'
import { MARKDOWN_RENDERER_TEST_EXPORTS } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
    test('formats think block with single Think label', () => {
        const lines = MARKDOWN_RENDERER_TEST_EXPORTS.formatThinkDisplayLines('line one\nline two\nline three')

        assert.deepStrictEqual(lines, ['Think: line one', 'line two', 'line three'])
    })

    test('keeps blank think lines without repeating label', () => {
        const lines = MARKDOWN_RENDERER_TEST_EXPORTS.formatThinkDisplayLines('\nline one\n')

        assert.deepStrictEqual(lines, ['', 'Think: line one', ''])
    })

    test('formats code blocks without decorative borders', () => {
        const lines = MARKDOWN_RENDERER_TEST_EXPORTS.formatCodeBlockLines("const x = 1\nconsole.log('ok')")

        assert.deepStrictEqual(lines, ['const x = 1', "console.log('ok')"])
    })

    test('uses codex-style short horizontal rule glyph', () => {
        assert.strictEqual(MARKDOWN_RENDERER_TEST_EXPORTS.HORIZONTAL_RULE_TEXT, '———')
    })
})
