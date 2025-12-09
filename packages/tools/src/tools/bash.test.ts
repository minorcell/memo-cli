import assert from 'node:assert'
import { describe, test } from 'bun:test'
import { bashTool } from '@memo/tools/tools/bash'

describe('bash tool', () => {
    test('returns prompt when command is empty', async () => {
        const res = await bashTool.execute({ command: '   ' })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('bash 需要要执行的命令'))
    })

    test('executes simple command and captures output', async () => {
        const res = await bashTool.execute({ command: 'echo hello' })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('exit=0'), 'exit code should be captured')
        assert.ok(text.includes('hello'), 'stdout should include command output')
    })
})
