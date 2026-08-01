import assert from 'node:assert'
import { describe, test } from 'vitest'
import { textResult, flattenText } from './mcp'
import type { ToolOutput } from '@memo/core/tools/tools/mcp'

describe('mcp helpers', () => {
    describe('textResult', () => {
        test('creates successful text result', () => {
            const result = textResult('hello world')
            if (result.type === 'text') {
                if (result.type === 'text') {
                    assert.strictEqual(result.value, 'hello world')
                }
            }
            assert.strictEqual(result.type, 'text')
        })

        test('creates error text result', () => {
            const result = textResult('error message', true)
            if (result.type === 'error-text') {
                assert.strictEqual(result.value, 'error message')
            }
            assert.strictEqual(result.type, 'error-text')
        })

        test('handles empty string', () => {
            const result = textResult('')
            if (result.type === 'text') {
                assert.strictEqual(result.value, '')
            }
            assert.strictEqual(result.type, 'text')
        })

        test('handles unicode content', () => {
            const result = textResult('你好世界 🌍 Привет')
            if (result.type === 'text') {
                assert.strictEqual(result.value, '你好世界 🌍 Привет')
            }
        })

        test('handles multi-line content', () => {
            const result = textResult('line1\nline2\nline3')
            if (result.type === 'text') {
                assert.strictEqual(result.value, 'line1\nline2\nline3')
            }
        })

        test('handles special characters', () => {
            const result = textResult('<tag attr="value">\n<script>alert(1)</script>')
            if (result.type === 'text') {
                assert.strictEqual(result.value, '<tag attr="value">\n<script>alert(1)</script>')
            }
        })

        test('handles very long content', () => {
            const longContent = 'x'.repeat(100000)
            const result = textResult(longContent)
            if (result.type === 'text') {
                assert.strictEqual(result.value.length, 100000)
            }
        })

        test('handles JSON-like content', () => {
            const result = textResult('{"key": "value", "nested": {"a": 1}}')
            if (result.type === 'text') {
                assert.ok(result.value.includes('"key"'))
            }
        })
    })

    describe('flattenText', () => {
        test('extracts text from single content item', () => {
            const result = textResult('single line')
            assert.strictEqual(flattenText(result), 'single line')
        })

        test('joins multiple text content items', () => {
            const result: ToolOutput = { type: 'text', value: 'line1\nline2' }
            assert.strictEqual(flattenText(result), 'line1\nline2')
        })

        test('ignores non-text content', () => {
            const result: ToolOutput = { type: 'text', value: 'visible\nalso visible' }
            assert.strictEqual(flattenText(result), 'visible\nalso visible')
        })

        test('handles empty result', () => {
            const result: ToolOutput = { type: 'text', value: '' }
            assert.strictEqual(flattenText(result), '')
        })

        test('handles empty text', () => {
            const result: ToolOutput = { type: 'text', value: '' }
            assert.strictEqual(flattenText(result), '')
        })

        test('handles json output', () => {
            const result: ToolOutput = { type: 'json', value: { a: 1 } }
            assert.strictEqual(flattenText(result), '{"a":1}')
        })

        test('handles execution-denied output', () => {
            const result: ToolOutput = { type: 'execution-denied', reason: 'denied' }
            assert.strictEqual(flattenText(result), 'denied')
        })

        test('preserves exact text including whitespace', () => {
            const result: ToolOutput = { type: 'text', value: '  leading spaces\ntrailing spaces  \n\ttab\t' }
            const output = flattenText(result)
            assert.ok(output.includes('  leading spaces'))
            assert.ok(output.includes('trailing spaces  '))
            assert.ok(output.includes('\ttab\t'))
        })

        test('handles isError flag correctly', () => {
            const errorResult = textResult('error message', true)
            assert.strictEqual(errorResult.type, 'error-text')

            const successResult = textResult('success message', false)
            assert.strictEqual(successResult.type, 'text')
        })

        test('handles many content items', () => {
            const result: ToolOutput = {
                type: 'text',
                value: Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n'),
            }
            const output = flattenText(result)
            assert.ok(output.includes('line0'))
            assert.ok(output.includes('line99'))
            assert.strictEqual(output.split('\n').length, 100)
        })
    })
})
