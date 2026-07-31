import { AsyncLocalStorage } from 'node:async_hooks'
import { resolve } from 'node:path'

export type RuntimeContext = {
    cwd?: string
}

const storage = new AsyncLocalStorage<RuntimeContext>()

function normalizeCwd(cwd: string | undefined): string | undefined {
    if (!cwd || !cwd.trim()) return undefined
    return resolve(cwd)
}

export function getRuntimeContext(): RuntimeContext {
    return storage.getStore() ?? {}
}

export function getRuntimeCwd(defaultCwd = process.cwd()): string {
    return normalizeCwd(getRuntimeContext().cwd) ?? defaultCwd
}

export async function runWithRuntimeContext<T>(context: RuntimeContext, fn: () => Promise<T> | T): Promise<T> {
    const normalized: RuntimeContext = {
        cwd: normalizeCwd(context.cwd),
    }
    return new Promise<T>((resolve, reject) => {
        storage.run(normalized, () => {
            Promise.resolve(fn()).then(resolve, reject)
        })
    })
}
