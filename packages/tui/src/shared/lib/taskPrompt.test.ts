import assert from 'node:assert'
import { describe, test } from 'vitest'
import { loadTaskPrompt } from './taskPrompt'

describe('task prompt loader', () => {
    test('loads init prompt markdown', async () => {
        const prompt = await loadTaskPrompt('init_agents')
        assert.ok(prompt.includes('Generate a file named AGENTS.md'))
    })
})
