import { mkdir } from "node:fs/promises"
import { dirname, normalize, resolve } from "node:path"

export async function ensureParentDir(path: string) {
    const dir = dirname(path)
    if (!dir || dir === "." || dir === "/") return
    await mkdir(dir, { recursive: true })
}

export function normalizePath(rawPath: string) {
    return normalize(resolve(rawPath))
}
