import assert from 'node:assert'
import { describe, test } from 'vitest'
import { textResult, flattenText } from './mcp'

describe('mcp helpers', () => {
    describe('textResult', () => {
        test('creates successful text result', () => {
            const result = textResult('hello world')
            assert.deepStrictEqual(result.content, [{ type: 'text', text: 'hello world' }])
            assert.strictEqual(result.isError, false)
        })

        test('creates error text result', () => {
            const result = textResult('error message', true)
            assert.deepStrictEqual(result.content, [{ type: 'text', text: 'error message' }])
            assert.strictEqual(result.isError, true)
        })

        test('handles empty string', () => {
            const result = textResult('')
            assert.deepStrictEqual(result.content, [{ type: 'text', text: '' }])
            assert.strictEqual(result.isError, false)
        })

        test('handles unicode content', () => {
            const result = textResult('你好世界 🌍 Привет')
            assert.strictEqual(result.content[0].text, '你好世界 🌍 Привет')
        })

        test('handles multi-line content', () => {
            const result = textResult('line1\nline2\nline3')
            assert.strictEqual(result.content[0].text, 'line1\nline2\nline3')
        })

        test('handles special characters', () => {
            const result = textResult('<tag attr="value">\n<script>alert(1)</script>')
            assert.strictEqual(result.content[0].text, '<tag attr="value">\n<script>alert(1)</script>')
        })

        test('handles very long content', () => {
            const longContent = 'x'.repeat(100000)
            const result = textResult(longContent)
            assert.strictEqual(result.content[0].text.length, 100000)
        })

        test('handles JSON-like content', () => {
            const result = textResult('{"key": "value", "nested": {"a": 1}}')
            assert.ok(result.content[0].text.includes('"key"'))
        })
    })

    describe('flattenText', () => {
        test('extracts text from single content item', () => {
            const result = textResult('single line')
            assert.strictEqual(flattenText(result), 'single line')
        })

        test('joins multiple text content items', () => {
            const result: Parameters<typeof flattenText>[0] = {
                content: [
                    { type: 'text', text: 'line1' },
                    { type: 'text', text: 'line2' },
                ],
                isError: false,
            }
            assert.strictEqual(flattenText(result), 'line1\nline2')
        })

        test('ignores non-text content', () => {
            const result: Parameters<typeof flattenText>[0] = {
                content: [
                    { type: 'text', text: 'visible' },
                    { type: 'image', data: 'base64data' },
                    { type: 'text', text: 'also visible' },
                ],
                isError: false,
            }
            assert.strictEqual(flattenText(result), 'visible\nalso visible')
        })

        test('handles empty result', () => {
            const result: Parameters<typeof flattenText>[0] = { content: [], isError: false }
            assert.strictEqual(flattenText(result), '')
        })

        test('handles undefined content', () => {
            const result: Parameters<typeof flattenText>[0] = { content: undefined, isError: false }
            assert.strictEqual(flattenText(result), '')
        })

        test('handles content with only non-text items', () => {
            const result: Parameters<typeof flattenText>[0] = {
                content: [
                    { type: 'image', data: 'base64' },
                    { type: 'resource', resource: { uri: 'file:///test' } },
                ],
                isError: false,
            }
            assert.strictEqual(flattenText(result), '')
        })

        test('handles mixed empty and non-empty text', () => {
            const result: Parameters<typeof flattenText>[0] = {
                content: [
                    { type: 'text', text: 'first' },
                    { type: 'text', text: '' },
                    { type: 'text', text: 'last' },
                ],
                isError: false,
            }
            assert.strictEqual(flattenText(result), 'first\n\nlast')
        })

        test('preserves exact text including whitespace', () => {
            const result: Parameters<typeof flattenText>[0] = {
                content: [
                    { type: 'text', text: '  leading spaces' },
                    { type: 'text', text: 'trailing spaces  ' },
                    { type: 'text', text: '\ttab\t' },
                ],
                isError: false,
            }
            const output = flattenText(result)
            assert.ok(output.includes('  leading spaces'))
            assert.ok(output.includes('trailing spaces  '))
            assert.ok(output.includes('\ttab\t'))
        })

        test('handles isError flag correctly', () => {
            const errorResult = textResult('error message', true)
            assert.strictEqual(errorResult.isError, true)

            const successResult = textResult('success message', false)
            assert.strictEqual(successResult.isError, false)
        })

        test('handles many content items', () => {
            const content = Array(100)
                .fill(null)
                .map((_, i) => ({ type: 'text' as const, text: `line${i}` }))
            const result: Parameters<typeof flattenText>[0] = { content, isError: false }
            const output = flattenText(result)
            assert.ok(output.includes('line0'))
            assert.ok(output.includes('line99'))
            assert.strictEqual(output.split('\n').length, 100)
        })
    })
})
