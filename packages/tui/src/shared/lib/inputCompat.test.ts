import assert from 'node:assert'
import { describe, test } from 'vitest'
import { pushChunk } from './inputCompat'

const ESC = '\u001b'

describe('pushChunk', () => {
    test('rewrites a complete modifyOtherKeys Shift+Enter to kitty form', () => {
        const result = pushChunk(null, `${ESC}[27;2;13~`)
        assert.deepStrictEqual(result.emit, [`${ESC}[13;2u`])
        assert.strictEqual(result.pending, null)
    })

    test('buffers partial sequences and completes across chunks', () => {
        const step1 = pushChunk(null, `${ESC}[27;`)
        assert.deepStrictEqual(step1.emit, [])
        assert.strictEqual(step1.pending, `${ESC}[27;`)

        const step2 = pushChunk(step1.pending, '2;13~')
        assert.deepStrictEqual(step2.emit, [`${ESC}[13;2u`])
        assert.strictEqual(step2.pending, null)
    })

    test('passes plain text through untouched', () => {
        const result = pushChunk(null, 'abc')
        assert.deepStrictEqual(result.emit, ['abc'])
        assert.strictEqual(result.pending, null)
    })

    test('passes recognized non-modifyOtherKeys escape sequences through', () => {
        const result = pushChunk(null, `${ESC}[A`)
        assert.deepStrictEqual(result.emit, [`${ESC}[A`])
        assert.strictEqual(result.pending, null)
    })

    test('flushes a dangling escape prefix as-is when it cannot complete', () => {
        const result = pushChunk(null, `${ESC}[X`)
        assert.deepStrictEqual(result.emit, [`${ESC}[X`])
        assert.strictEqual(result.pending, null)
    })

    test('rewrites a modifyOtherKeys Shift+Enter embedded in plain text', () => {
        const result = pushChunk(null, `abc${ESC}[27;2;13~def`)
        assert.deepStrictEqual(result.emit, ['abc', `${ESC}[13;2u`, 'def'])
        assert.strictEqual(result.pending, null)
    })

    test('buffers a mid-chunk partial sequence for the next chunk', () => {
        const step1 = pushChunk(null, `abc${ESC}[27;`)
        assert.deepStrictEqual(step1.emit, ['abc'])
        assert.strictEqual(step1.pending, `${ESC}[27;`)

        const step2 = pushChunk(step1.pending, '2;13~def')
        assert.deepStrictEqual(step2.emit, [`${ESC}[13;2u`, 'def'])
        assert.strictEqual(step2.pending, null)
    })

    test('drops the pending buffer once it grows past the max', () => {
        const pending = `${ESC}[27;123456789`
        const result = pushChunk(pending, '012345')
        assert.deepStrictEqual(result.emit, [`${ESC}[27;123456789012345`])
        assert.strictEqual(result.pending, null)
    })
})
