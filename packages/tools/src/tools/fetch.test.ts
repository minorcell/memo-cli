import assert from 'node:assert'
import { describe, test } from 'bun:test'
import { fetchTool } from '@memo/tools/tools/fetch'

describe('fetch tool', () => {
    test('requires url', async () => {
        const res = await fetchTool.inputSchema.safeParse({ url: '' })
        assert.strictEqual(res.success, false)
    })

    test('fetches data url content', async () => {
        const res = await fetchTool.execute({ url: 'data:text/plain,hello' })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('status=200'))
        assert.ok(text.includes('body="hello"'))
    })

    test('rejects unsupported protocol', async () => {
        const res = await fetchTool.execute({ url: 'file:///etc/hosts' })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('不支持的协议'), 'should block file:// scheme')
    })

    test('aborts when body is too large', async () => {
        const large = 'a'.repeat(600_000)
        const res = await fetchTool.execute({ url: `data:text/plain,${large}` })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('响应体超过'), 'should enforce size limit')
    })
})
