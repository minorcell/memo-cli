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

    test('terminates a session whose output exceeds the hard cap', async () => {
        const { startExecSession } = await import('./exec_runtime')
        // `yes` writes forever; the 16 MiB hard cap must kill it and mark the
        // output as truncated, otherwise the process stays running and the
        // response never reports an exit.
        const response = await startExecSession({ cmd: 'yes x', max_output_tokens: 5_000_000 })
        expect(response).toContain('[exec output truncated: exceeded 16 MiB; process terminated]')
        expect(response).toMatch(/Process exited with code -1/)
    }, 60_000)
})
