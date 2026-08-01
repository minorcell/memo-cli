import assert from 'node:assert'
import { describe, test } from 'vitest'
import { COMPOSER_COLOR, resolveComposerColor } from './composerColor'

describe('composer_color', () => {
    test('disabled wins over everything, including thinking and running', () => {
        for (const operationStatus of ['idle', 'running', 'awaiting_approval', 'cancelling', 'compacting'] as const) {
            assert.strictEqual(
                resolveComposerColor({ disabled: true, operationStatus, thinkingOn: true }),
                COMPOSER_COLOR.disabled,
            )
            assert.strictEqual(
                resolveComposerColor({ disabled: true, operationStatus, thinkingOn: false }),
                COMPOSER_COLOR.disabled,
            )
        }
    })

    test('idle without thinking stays cyan', () => {
        assert.strictEqual(
            resolveComposerColor({ disabled: false, operationStatus: 'idle', thinkingOn: false }),
            COMPOSER_COLOR.idle,
        )
    })

    test('idle with thinking on uses the amber thinking color', () => {
        assert.strictEqual(
            resolveComposerColor({ disabled: false, operationStatus: 'idle', thinkingOn: true }),
            COMPOSER_COLOR.thinking,
        )
        assert.notStrictEqual(COMPOSER_COLOR.thinking, COMPOSER_COLOR.idle)
        assert.notStrictEqual(COMPOSER_COLOR.thinking, COMPOSER_COLOR.running)
    })

    test('transient running states keep yellow even when thinking is on', () => {
        for (const operationStatus of ['running', 'awaiting_approval', 'cancelling', 'compacting'] as const) {
            assert.strictEqual(
                resolveComposerColor({ disabled: false, operationStatus, thinkingOn: true }),
                COMPOSER_COLOR.running,
            )
            assert.strictEqual(
                resolveComposerColor({ disabled: false, operationStatus, thinkingOn: false }),
                COMPOSER_COLOR.running,
            )
        }
    })
})
