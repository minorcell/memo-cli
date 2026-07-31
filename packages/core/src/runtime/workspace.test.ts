import assert from 'node:assert'
import { describe, test } from 'vitest'
import {
    cwdBelongsToWorkspace,
    defaultWorkspaceName,
    normalizeWorkspaceName,
    normalizeWorkspacePath,
    workspaceIdFromCwd,
} from './workspace'

describe('workspace runtime helpers', () => {
    test('normalizeWorkspacePath trims and normalizes separators', () => {
        const normalized = normalizeWorkspacePath(' ./tmp/workspace/// ')
        assert.ok(normalized.endsWith('/tmp/workspace'))
        assert.ok(!normalized.endsWith('//'))
    })

    test('workspaceIdFromCwd is stable and fixed-length', () => {
        const first = workspaceIdFromCwd('/tmp/demo-project')
        const second = workspaceIdFromCwd('/tmp/demo-project/')
        assert.strictEqual(first, second)
        assert.strictEqual(first.length, 16)
    })

    test('defaultWorkspaceName falls back to normalized path for root', () => {
        assert.strictEqual(defaultWorkspaceName('/'), '/')
        assert.strictEqual(defaultWorkspaceName('/tmp/my-project'), 'my-project')
    })

    test('normalizeWorkspaceName prefers trimmed explicit name', () => {
        assert.strictEqual(normalizeWorkspaceName('  Team Workspace  ', '/tmp/demo'), 'Team Workspace')
        assert.strictEqual(normalizeWorkspaceName('   ', '/tmp/demo'), 'demo')
    })

    test('cwdBelongsToWorkspace checks boundary correctly', () => {
        assert.strictEqual(cwdBelongsToWorkspace('/tmp/workspace', '/tmp/workspace'), true)
        assert.strictEqual(cwdBelongsToWorkspace('/tmp/workspace/sub', '/tmp/workspace'), true)
        assert.strictEqual(cwdBelongsToWorkspace('/tmp/workspace-2', '/tmp/workspace'), false)
    })
})
