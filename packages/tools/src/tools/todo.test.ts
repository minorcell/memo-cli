import assert from 'node:assert'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, test, beforeAll, afterAll } from 'bun:test'
import { $ } from 'bun'
import { todoTool } from '@memo/tools/tools/todo'

let tempHome: string
let prevMemoHome: string | undefined

async function makeTempDir(prefix: string) {
    const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`)
    await $`mkdir -p ${dir}`
    return dir
}

async function removeDir(dir: string) {
    await $`rm -rf ${dir}`
}

async function readJson(path: string) {
    const file = Bun.file(path)
    if (!(await file.exists())) return undefined
    return JSON.parse(await file.text())
}

describe('todo tool', () => {
    beforeAll(async () => {
        tempHome = await makeTempDir('memo-tools-todo')
        prevMemoHome = process.env.MEMO_HOME
        process.env.MEMO_HOME = tempHome
    })

    afterAll(async () => {
        if (prevMemoHome === undefined) {
            delete process.env.MEMO_HOME
        } else {
            process.env.MEMO_HOME = prevMemoHome
        }
        await removeDir(tempHome)
    })

    test('add then update and remove tasks', async () => {
        const addRes = await todoTool.execute({
            type: 'add',
            todos: [
                { content: '修复认证bug', status: 'pending' },
                { content: '运行测试', status: 'pending' },
            ],
        })
        const addPayload = JSON.parse(
            addRes.content?.[0]?.type === 'text' ? addRes.content[0].text : '{}',
        )
        assert.strictEqual(addPayload.count, 2)
        const id = addPayload.tasks[0].id

        const updateRes = await todoTool.execute({
            type: 'update',
            todos: [{ id, content: '修复认证bug', status: 'in_progress' }],
        })
        const updatePayload = JSON.parse(
            updateRes.content?.[0]?.type === 'text' ? updateRes.content[0].text : '{}',
        )
        assert.strictEqual(updatePayload.tasks[0].status, 'in_progress')

        const removeRes = await todoTool.execute({
            type: 'remove',
            ids: [id],
        })
        const removePayload = JSON.parse(
            removeRes.content?.[0]?.type === 'text' ? removeRes.content[0].text : '{}',
        )
        assert.strictEqual(removePayload.count, 1)
        assert.strictEqual(removePayload.tasks.length, 1)
    })

    test('rejects exceeding max tasks', async () => {
        const todos = Array.from({ length: 11 }, (_, i) => ({
            content: `t${i}`,
            status: 'pending' as const,
        }))
        const res = await todoTool.execute({ type: 'add', todos })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.includes('上限'), 'should reject when exceeding limit')
    })

    test('rejects update with missing id', async () => {
        const res = await todoTool.execute({
            type: 'update',
            todos: [{ id: 'missing', content: 'x', status: 'pending' }],
        })
        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(res.isError, 'should be error')
        assert.ok(text.includes('未找到任务'), 'should mention missing id')
    })

    test('rejects invalid status enum', () => {
        const parsed = todoTool.inputSchema.safeParse({
            type: 'add',
            todos: [{ content: 'x', status: 'done' }],
        })
        assert.strictEqual(parsed.success, false)
    })
})
