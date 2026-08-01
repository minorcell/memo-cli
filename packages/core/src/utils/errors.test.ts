import { describe, expect, test } from 'vitest'
import { isAbortError } from '@memo/core/utils/errors'

describe('isAbortError', () => {
    test('detects abort error by name and message', () => {
        const abortError = new Error('cancelled')
        abortError.name = 'AbortError'
        const abortedMessageError = new Error('Request was aborted.')
        expect(isAbortError(abortError)).toBe(true)
        expect(isAbortError(abortedMessageError)).toBe(true)
        expect(isAbortError(new Error('other'))).toBe(false)
        expect(isAbortError('AbortError')).toBe(false)
    })
})
