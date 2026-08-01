import assert from 'node:assert'
import { describe, test } from 'vitest'
import { previewText } from './contentPreview'

describe('previewText', () => {
    test('keeps short content unchanged', () => {
        assert.deepStrictEqual(previewText('short text', { columns: 20, maxLines: 2 }), {
            text: 'short text',
            truncated: false,
        })
    })

    test('limits content from the start by terminal columns and lines', () => {
        assert.deepStrictEqual(previewText('1234567890', { columns: 5, maxLines: 1 }), {
            text: '1234…',
            truncated: true,
        })
    })

    test('keeps the latest lines when previewing streaming content', () => {
        assert.deepStrictEqual(previewText('one\ntwo\nthree\nfour\nfive', { columns: 20, maxLines: 3, from: 'end' }), {
            text: '…\nfour\nfive',
            truncated: true,
        })
    })

    test('measures wide characters using terminal column width', () => {
        assert.deepStrictEqual(previewText('你好世界', { columns: 4, maxLines: 1 }), {
            text: '你…',
            truncated: true,
        })
    })
})
