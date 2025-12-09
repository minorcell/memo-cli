import { z } from 'zod'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

// 在进程内维护任务列表，进程退出后清空
type StoredTask = {
    id: string
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    activeForm: string
}

const MAX_TASKS = 10
const tasks: StoredTask[] = []

const TASK_SCHEMA = z
    .object({
        content: z.string().trim().min(1, 'content 不能为空').max(100, 'content 最长 100 字符'),
        status: z.enum(['pending', 'in_progress', 'completed']),
        activeForm: z
            .string()
            .trim()
            .min(1, 'activeForm 不能为空')
            .max(120, 'activeForm 最长 120 字符'),
    })
    .strict()

const ADD_SCHEMA = z.object({
    type: z.literal('add'),
    todos: z.array(TASK_SCHEMA).min(1, 'todos 不能为空').max(10, 'todos 最多 10 条'),
})

const REPLACE_SCHEMA = z.object({
    type: z.literal('replace'),
    todos: z.array(TASK_SCHEMA).min(1, 'todos 不能为空').max(10, 'todos 最多 10 条'),
})

const UPDATE_SCHEMA = z.object({
    type: z.literal('update'),
    todos: z
        .array(
            TASK_SCHEMA.extend({
                id: z.string().min(1, 'id 不能为空'),
            }),
        )
        .min(1, 'todos 不能为空')
        .max(10, 'todos 最多 10 条'),
})

const REMOVE_SCHEMA = z.object({
    type: z.literal('remove'),
    ids: z.array(z.string().min(1, 'id 不能为空')).min(1, 'ids 不能为空'),
})

const TODO_INPUT_SCHEMA = z.discriminatedUnion('type', [
    ADD_SCHEMA,
    REPLACE_SCHEMA,
    UPDATE_SCHEMA,
    REMOVE_SCHEMA,
])

type TodoInput = z.infer<typeof TODO_INPUT_SCHEMA>

function cloneTasks() {
    return tasks.map((t) => ({ ...t }))
}

function mutate(input: TodoInput) {
    switch (input.type) {
        case 'add': {
            const remaining = MAX_TASKS - tasks.length
            if (input.todos.length > remaining) {
                return { error: `任务上限 ${MAX_TASKS}，当前剩余 ${remaining} 条空位` }
            }
            const added = input.todos.map((t) => ({
                id: crypto.randomUUID(),
                content: t.content,
                status: t.status,
                activeForm: t.activeForm,
            }))
            tasks.push(...added)
            return { added, tasks: cloneTasks() }
        }
        case 'replace': {
            if (input.todos.length > MAX_TASKS) {
                return { error: `任务上限 ${MAX_TASKS}` }
            }
            tasks.splice(0, tasks.length)
            const replaced = input.todos.map((t) => ({
                id: crypto.randomUUID(),
                content: t.content,
                status: t.status,
                activeForm: t.activeForm,
            }))
            tasks.push(...replaced)
            return { replaced: true, tasks: cloneTasks() }
        }
        case 'update': {
            const ids = input.todos.map((t) => t.id)
            const idSet = new Set(ids)
            if (idSet.size !== ids.length) {
                return { error: '更新列表存在重复 id' }
            }
            const map = new Map(tasks.map((t) => [t.id, t]))
            for (const upd of input.todos) {
                const found = map.get(upd.id)
                if (!found) return { error: `未找到任务 id=${upd.id}` }
                found.content = upd.content
                found.status = upd.status
                found.activeForm = upd.activeForm
            }
            return { updated: ids, tasks: cloneTasks() }
        }
        case 'remove': {
            const before = tasks.length
            const removeSet = new Set(input.ids)
            const kept = tasks.filter((t) => !removeSet.has(t.id))
            if (kept.length === before) {
                return { error: '未找到任何可删除的任务 id' }
            }
            tasks.splice(0, tasks.length, ...kept)
            return { removed: input.ids, tasks: cloneTasks() }
        }
    }
}

/** todo: 进程内待办管理（add/update/remove/replace），最多 10 条，不持久化。 */
export const todoTool: McpTool<TodoInput> = {
    name: 'todo',
    description: '管理待办列表（add/update/remove/replace），最多 10 条，不持久化',
    inputSchema: TODO_INPUT_SCHEMA,
    execute: async (input) => {
        const result = mutate(input)
        if (result.error) return textResult(result.error, true)
        const payload = {
            op: input.type,
            count: tasks.length,
            tasks: result.tasks,
            added: (result as any).added,
            updated: (result as any).updated,
            removed: (result as any).removed,
            replaced: Boolean((result as any).replaced),
        }
        return textResult(JSON.stringify(payload))
    },
}
