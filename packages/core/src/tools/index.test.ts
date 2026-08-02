import assert from 'node:assert'
import { afterEach, describe, test, vi } from 'vitest'

describe('toolkit defaults', () => {
    afterEach(() => {
        delete process.env.MEMO_ENABLE_COLLAB_TOOLS
        vi.resetModules()
    })

    test('enables collab tools by default', async () => {
        delete process.env.MEMO_ENABLE_COLLAB_TOOLS
        vi.resetModules()
        const mod = await import('./index')
        assert.ok(mod.TOOLKIT.spawn_agent)
        assert.ok(mod.TOOLKIT.send_message)
        assert.ok(mod.TOOLKIT.followup_task)
        assert.ok(mod.TOOLKIT.wait_agent)
        assert.ok(mod.TOOLKIT.interrupt_agent)
        assert.ok(mod.TOOLKIT.list_agents)
    })

    test('allows explicit disabling collab tools via MEMO_ENABLE_COLLAB_TOOLS=0', async () => {
        process.env.MEMO_ENABLE_COLLAB_TOOLS = '0'
        vi.resetModules()
        const mod = await import('./index')
        assert.strictEqual(mod.TOOLKIT.spawn_agent, undefined)
        assert.strictEqual(mod.TOOLKIT.send_message, undefined)
        assert.strictEqual(mod.TOOLKIT.followup_task, undefined)
        assert.strictEqual(mod.TOOLKIT.wait_agent, undefined)
        assert.strictEqual(mod.TOOLKIT.interrupt_agent, undefined)
        assert.strictEqual(mod.TOOLKIT.list_agents, undefined)
    })
})
