import assert from 'node:assert'
import { describe, test } from 'vitest'
import { resolveDeleteKind, resolveModifiedEnter } from './composerKeys'

describe('composer_keys', () => {
    test('prefers explicit backspace flag', () => {
        assert.strictEqual(resolveDeleteKind('', { backspace: true, delete: true }), 'backspace')
    })

    test('treats delete flag as backspace by default (ink compatibility)', () => {
        assert.strictEqual(resolveDeleteKind('', { delete: true }), 'backspace')
    })

    test('supports forward delete via modified delete key', () => {
        assert.strictEqual(resolveDeleteKind('', { delete: true, ctrl: true }), 'delete')
        assert.strictEqual(resolveDeleteKind('', { delete: true, meta: true }), 'delete')
    })

    test('treats DEL control char as backspace', () => {
        assert.strictEqual(resolveDeleteKind('\u007f', {}), 'backspace')
        assert.strictEqual(resolveDeleteKind('\u007f', { delete: true }), 'backspace')
    })

    test('treats BS control char as backspace', () => {
        assert.strictEqual(resolveDeleteKind('\u0008', {}), 'backspace')
    })

    test('treats Ctrl+H as backspace', () => {
        assert.strictEqual(resolveDeleteKind('h', { ctrl: true }), 'backspace')
        assert.strictEqual(resolveDeleteKind('H', { ctrl: true }), 'backspace')
    })

    test('non delete-like input stays none', () => {
        assert.strictEqual(resolveDeleteKind('a', {}), 'none')
    })
})

describe('resolveModifiedEnter', () => {
    test('maps xterm modifyOtherKeys enter variants to newline', () => {
        assert.strictEqual(resolveModifiedEnter('\u001b[27;2;13~'), 'newline')
        assert.strictEqual(resolveModifiedEnter('\u001b[27;1;13~'), 'newline')
    })

    test('maps the bare form after Ink strips the leading ESC', () => {
        assert.strictEqual(resolveModifiedEnter('[27;2;13~'), 'newline')
        assert.strictEqual(resolveModifiedEnter('[27;1;13~'), 'newline')
    })

    test('plain text resembling the sequence passes through', () => {
        assert.strictEqual(resolveModifiedEnter('[27;abc'), 'none')
        assert.strictEqual(resolveModifiedEnter('[27;2;13~suffix'), 'none')
    })

    test('ignores other modifyOtherKeys keys instead of inserting them', () => {
        assert.strictEqual(resolveModifiedEnter('\u001b[27;2;9~'), 'ignore')
    })

    test('ignores unrecognized escape sequences instead of inserting them', () => {
        assert.strictEqual(resolveModifiedEnter('\u001b[13;2u'), 'ignore')
        assert.strictEqual(resolveModifiedEnter('\u001b[1;5D'), 'ignore')
    })

    test('plain text passes through untouched', () => {
        assert.strictEqual(resolveModifiedEnter('a'), 'none')
        assert.strictEqual(resolveModifiedEnter(''), 'none')
    })
})
