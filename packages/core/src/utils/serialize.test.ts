import { describe, expect, test } from 'vitest'
import { stableStringify } from '@memo/core/utils/serialize'

describe('stableStringify', () => {
    test('serializes self-referencing object without throwing', () => {
        const root: Record<string, unknown> = {}
        root.self = root

        const serialized = stableStringify(root)
        expect(serialized).toBe('{"self":"[Circular]"}')
    })

    test('serializes indirect circular references with circular marker', () => {
        const parent: Record<string, unknown> = { name: 'parent' }
        const child: Record<string, unknown> = { name: 'child', parent }
        parent.child = child

        const serialized = stableStringify(parent)
        expect(serialized).toContain('"child":{"name":"child","parent":"[Circular]"}')
        expect(serialized).toContain('"name":"parent"')
    })
})
