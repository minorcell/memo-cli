import assert from 'node:assert'
import { describe, test } from 'vitest'
import { TOOL_STATUS, type StepView } from '../../shared/types'
import { collectTimelineItems } from './Cells'

function readStep(
    index: number,
    path: string,
    status: (typeof TOOL_STATUS)[keyof typeof TOOL_STATUS] = TOOL_STATUS.SUCCESS,
): StepView {
    return {
        index,
        assistantText: '',
        action: { tool: 'read', input: { path } },
        toolResults: [{ tool: 'read', observation: 'ok', status }],
    }
}

describe('collectTimelineItems', () => {
    test('merges consecutive successful reads into one item', () => {
        const items = collectTimelineItems(
            [readStep(0, '/repo/a.ts'), readStep(1, '/repo/b.ts'), readStep(2, '/repo/c.ts')],
            '/repo',
            120,
        )

        assert.strictEqual(items.length, 1)
        assert.deepStrictEqual(items[0], {
            type: 'merged',
            tool: 'read',
            label: 'Read 3 files',
            params: ['a.ts', 'b.ts', 'c.ts'],
        })
    })

    test('keeps a single read as a step', () => {
        const items = collectTimelineItems([readStep(0, '/repo/a.ts')], '/repo', 120)

        assert.strictEqual(items.length, 1)
        assert.deepStrictEqual(items[0], { type: 'step', step: readStep(0, '/repo/a.ts') })
    })

    test('does not merge a failed read', () => {
        const items = collectTimelineItems(
            [readStep(0, '/repo/a.ts'), readStep(1, '/repo/b.ts', TOOL_STATUS.ERROR)],
            '/repo',
            120,
        )

        assert.strictEqual(items.length, 2)
        assert.ok(items.every((item) => item.type === 'step'))
    })

    test('a step with assistant text interrupts the run', () => {
        const textStep: StepView = {
            index: 1,
            assistantText: 'processing',
            action: { tool: 'read', input: { path: '/repo/mid.ts' } },
        }
        const items = collectTimelineItems(
            [readStep(0, '/repo/a.ts'), textStep, readStep(2, '/repo/c.ts')],
            '/repo',
            120,
        )

        assert.strictEqual(items.length, 3)
        assert.ok(items.every((item) => item.type === 'step'))
    })

    test('does not merge non-read tools', () => {
        const execStep: StepView = {
            index: 1,
            assistantText: '',
            action: { tool: 'exec_command', input: { cmd: 'ls' } },
            toolResults: [{ tool: 'exec_command', observation: 'ok', status: TOOL_STATUS.SUCCESS }],
        }
        const items = collectTimelineItems(
            [readStep(0, '/repo/a.ts'), execStep, readStep(2, '/repo/c.ts')],
            '/repo',
            120,
        )

        assert.strictEqual(items.length, 3)
        assert.ok(items.every((item) => item.type === 'step'))
    })

    test('groups per tool: two reads then two searches stay separate', () => {
        const searchStep = (index: number, pattern: string): StepView => ({
            index,
            assistantText: '',
            action: { tool: 'search_files', input: { pattern } },
            toolResults: [{ tool: 'search_files', observation: 'ok', status: TOOL_STATUS.SUCCESS }],
        })
        const items = collectTimelineItems(
            [readStep(0, '/repo/a.ts'), readStep(1, '/repo/b.ts'), searchStep(2, '*.md'), searchStep(3, '*.ts')],
            '/repo',
            120,
        )

        assert.strictEqual(items.length, 2)
        assert.deepStrictEqual(items[0], {
            type: 'merged',
            tool: 'read',
            label: 'Read 2 files',
            params: ['a.ts', 'b.ts'],
        })
        assert.deepStrictEqual(items[1], {
            type: 'merged',
            tool: 'search_files',
            label: 'Searched 2 patterns',
            params: ['*.md', '*.ts'],
        })
    })
})
