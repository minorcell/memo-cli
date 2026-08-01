import assert from 'node:assert'
import { describe, test, expect } from 'vitest'

describe('exec_runtime exports', () => {
    test('startExecSession is exported', async () => {
        const mod = await import('./exec_runtime')
        assert.strictEqual(typeof mod.startExecSession, 'function')
    })

    test('writeExecSession is exported', async () => {
        const mod = await import('./exec_runtime')
        assert.strictEqual(typeof mod.writeExecSession, 'function')
    })

    test('startExecSession rejects empty command', async () => {
        const { startExecSession } = await import('./exec_runtime')
        await expect(startExecSession({ cmd: '' })).rejects.toThrow('cmd must not be empty')
    })

    test('writeExecSession rejects unknown session', async () => {
        const { writeExecSession } = await import('./exec_runtime')
        await expect(writeExecSession({ session_id: 99999 })).rejects.toThrow('not found')
    })
})
