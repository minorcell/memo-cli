import assert from 'node:assert'
import { describe, test } from 'vitest'
import { isAgentsMdWrite } from './initApproval'

const CWD = '/work/project'

describe('isAgentsMdWrite', () => {
    test('write_file to cwd/AGENTS.md is approved', () => {
        assert.equal(isAgentsMdWrite('write_file', { path: 'AGENTS.md', content: 'x' }, CWD), true)
    })

    test('write_file with ./ prefix is approved', () => {
        assert.equal(isAgentsMdWrite('write_file', { path: './AGENTS.md' }, CWD), true)
    })

    test('write_file with absolute path is approved', () => {
        assert.equal(isAgentsMdWrite('write_file', { path: '/work/project/AGENTS.md' }, CWD), true)
    })

    test('write_file with normalized path is approved', () => {
        assert.equal(isAgentsMdWrite('write_file', { path: 'sub/../AGENTS.md' }, CWD), true)
    })

    test('write_file to another file is denied', () => {
        assert.equal(isAgentsMdWrite('write_file', { path: 'README.md' }, CWD), false)
    })

    test('write_file to AGENTS.md in a subdirectory is denied', () => {
        assert.equal(isAgentsMdWrite('write_file', { path: 'docs/AGENTS.md' }, CWD), false)
    })

    test('write_file outside cwd is denied', () => {
        assert.equal(isAgentsMdWrite('write_file', { path: '../AGENTS.md' }, CWD), false)
        assert.equal(isAgentsMdWrite('write_file', { path: '/etc/AGENTS.md' }, CWD), false)
    })

    test('write_file with missing or non-string path is denied', () => {
        assert.equal(isAgentsMdWrite('write_file', {}, CWD), false)
        assert.equal(isAgentsMdWrite('write_file', { path: 42 }, CWD), false)
        assert.equal(isAgentsMdWrite('write_file', { path: '' }, CWD), false)
    })

    test('edit_file to cwd/AGENTS.md is approved', () => {
        assert.equal(isAgentsMdWrite('edit_file', { path: 'AGENTS.md', edits: [] }, CWD), true)
    })

    test('edit_file to another path is denied', () => {
        assert.equal(isAgentsMdWrite('edit_file', { path: 'src/AGENTS.md' }, CWD), false)
    })

    test('apply_patch updating cwd/AGENTS.md is approved', () => {
        const patch = '*** Begin Patch\n*** Update File: AGENTS.md\n@@\n*** End Patch'
        assert.equal(isAgentsMdWrite('apply_patch', { input: patch }, CWD), true)
    })

    test('apply_patch adding cwd/AGENTS.md is approved', () => {
        const patch = '*** Add File: AGENTS.md\n+ title\n'
        assert.equal(isAgentsMdWrite('apply_patch', { input: patch }, CWD), true)
    })

    test('apply_patch with absolute AGENTS.md path is approved', () => {
        const patch = '*** Update File: /work/project/AGENTS.md\n@@\n'
        assert.equal(isAgentsMdWrite('apply_patch', { input: patch }, CWD), true)
    })

    test('apply_patch touching AGENTS.md elsewhere is denied', () => {
        const patch = '*** Update File: docs/AGENTS.md\n@@\n'
        assert.equal(isAgentsMdWrite('apply_patch', { input: patch }, CWD), false)
    })

    test('apply_patch deleting AGENTS.md is denied', () => {
        const patch = '*** Delete File: AGENTS.md\n'
        assert.equal(isAgentsMdWrite('apply_patch', { input: patch }, CWD), false)
    })

    test('apply_patch mixing AGENTS.md with another file is denied', () => {
        const patch = '*** Update File: AGENTS.md\n@@\n*** Update File: README.md\n@@\n'
        assert.equal(isAgentsMdWrite('apply_patch', { input: patch }, CWD), false)
    })

    test('apply_patch on unrelated files is denied', () => {
        const patch = '*** Update File: README.md\n@@\n'
        assert.equal(isAgentsMdWrite('apply_patch', { input: patch }, CWD), false)
    })

    test('apply_patch with missing or non-string input is denied', () => {
        assert.equal(isAgentsMdWrite('apply_patch', {}, CWD), false)
        assert.equal(isAgentsMdWrite('apply_patch', { input: 42 }, CWD), false)
    })

    test('non-write tools are denied', () => {
        assert.equal(isAgentsMdWrite('shell', { command: 'echo hi' }, CWD), false)
        assert.equal(isAgentsMdWrite('exec_command', {}, CWD), false)
        assert.equal(isAgentsMdWrite('unknown_tool', { path: 'AGENTS.md' }, CWD), false)
    })

    test('non-object params are denied', () => {
        assert.equal(isAgentsMdWrite('write_file', null, CWD), false)
        assert.equal(isAgentsMdWrite('write_file', undefined, CWD), false)
        assert.equal(isAgentsMdWrite('apply_patch', null, CWD), false)
    })
})
