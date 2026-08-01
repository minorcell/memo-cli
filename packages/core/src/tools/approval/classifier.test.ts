import assert from 'node:assert'
import { describe, test } from 'vitest'
import { createToolClassifier } from './classifier'

describe('tool classifier', () => {
    test('classifies apply_patch as write risk', () => {
        const classifier = createToolClassifier()
        assert.strictEqual(classifier.getRiskLevel('apply_patch'), 'write')
        assert.strictEqual(classifier.needsApproval('write', 'auto'), true)
    })
})
