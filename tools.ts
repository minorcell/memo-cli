import { appendFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { WriteParseResult, ToolName, ToolFn } from "./types"

function parseWriteInput(input: string): WriteParseResult {
    try {
        const parsed = JSON.parse(input)
        const path = parsed?.path
        const content = parsed?.content ?? ""
        const mode = parsed?.mode === "append" ? "append" : "overwrite"

        if (!path || typeof path !== "string") {
            return { error: "write 需要 path 字符串" }
        }

        return {
            path,
            content: String(content),
            mode: mode as "append" | "overwrite",
        }
    } catch {
        return { error: 'write 参数需为 JSON，如 {"path":"notes.txt","content":"...", "mode":"overwrite|append"}' }
    }
}

async function ensureParentDir(path: string) {
    const dir = dirname(path)
    if (!dir || dir === "." || dir === "/") return
    await mkdir(dir, { recursive: true })
}

export const TOOLKIT: Record<ToolName, ToolFn> = {
    async getTime() {
        return new Date().toISOString()
    },

    async bash(rawCmd: string) {
        const cmd = rawCmd.trim()
        if (!cmd) return "bash 需要要执行的命令"

        try {
            const proc = Bun.spawn(["bash", "-lc", cmd], {
                stdout: "pipe",
                stderr: "pipe",
                env: process.env,
            })

            const [stdout, stderr] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ])
            const exitCode = await proc.exited

            return `exit=${exitCode} stdout="${stdout}" stderr="${stderr}"`
        } catch (err) {
            return `bash 执行失败: ${(err as Error).message}`
        }
    },

    async read(rawPath: string) {
        const path = rawPath.trim()
        if (!path) return "read 需要文件路径"

        try {
            const file = Bun.file(path)
            if (!(await file.exists())) {
                return `文件不存在: ${path}`
            }

            const content = await file.text()
            return content
        } catch (err) {
            return `读取失败: ${(err as Error).message}`
        }
    },

    async write(rawInput: string): Promise<string> {
        const parsed = parseWriteInput(rawInput.trim())
        if ("error" in parsed) return parsed.error

        const { path, content, mode } = parsed
        try {
            await ensureParentDir(path)
            if (mode === "append") {
                await appendFile(path, content, { encoding: "utf8" })
            } else {
                await writeFile(path, content, { encoding: "utf8" })
            }
            return `已写入 ${path} (mode=${mode}, length=${content.length})`
        } catch (err) {
            return `写入失败: ${(err as Error).message}`
        }
    },

    async fetch(rawUrl: string) {
        const url = rawUrl.trim()
        if (!url) return "fetch 需要 URL"
        try {
            const res = await globalThis.fetch(url)
            const body = await res.text()
            return `status=${res.status} length=${body.length} body="${body}"`
        } catch (err) {
            return `请求失败: ${(err as Error).message}`
        }
    },
}
