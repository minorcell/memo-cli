import type { ToolFn } from "@memo/tools/tools/types"
import { normalizePath } from "@memo/tools/tools/helpers"

type OutputMode = "content" | "files_with_matches" | "count"
type GrepInput =
    | {
          pattern?: string
          path?: string
          output_mode?: OutputMode
          glob?: string
          "-i"?: boolean
          "-A"?: number
          "-B"?: number
          "-C"?: number
      }
    | { error: string }

/** 解析 grep 入参，兼容常见 ripgrep 选项与输出模式。 */
function parseGrepInput(input: string): GrepInput {
    try {
        const parsed = JSON.parse(input)
        if (!parsed?.pattern || typeof parsed.pattern !== "string") {
            return { error: "grep 需要 pattern 字符串" }
        }
        if (parsed.path !== undefined && typeof parsed.path !== "string") {
            return { error: "path 需为字符串" }
        }
        if (
            parsed.output_mode !== undefined &&
            parsed.output_mode !== "content" &&
            parsed.output_mode !== "files_with_matches" &&
            parsed.output_mode !== "count"
        ) {
            return { error: 'output_mode 仅支持 "content"|"files_with_matches"|"count"' }
        }
        const ctxKeys: Array<"-A" | "-B" | "-C"> = ["-A", "-B", "-C"]
        for (const key of ctxKeys) {
            const val = parsed[key]
            if (val !== undefined && (!Number.isInteger(val) || val < 0)) {
                return { error: `${key} 需为非负整数` }
            }
        }
        if (parsed["-i"] !== undefined && typeof parsed["-i"] !== "boolean") {
            return { error: "-i 需为布尔值" }
        }
        if (parsed.glob !== undefined && typeof parsed.glob !== "string") {
            return { error: "glob 需为字符串" }
        }
        return parsed as GrepInput
    } catch {
        return {
            error: 'grep 参数需为 JSON，如 {"pattern":"TODO","path":".","output_mode":"content","glob":"src/**/*.ts","-i":false,"-A":2}',
        }
    }
}

/**
 * 基于 ripgrep 查找文本，支持内容/文件列表/计数三种输出。
 * 入参为 JSON 字符串，内部负责调用 rg 并处理错误码。
 */
export const grep: ToolFn = async (rawInput: string) => {
    const parsed = parseGrepInput(rawInput.trim())
    if ("error" in parsed) return parsed.error

    const basePath = parsed.path ? normalizePath(parsed.path) : process.cwd()
    const args = ["rg", "--color", "never"] // 使用 ripgrep，禁用颜色方便解析
    const mode = parsed.output_mode ?? "content"

    if (mode === "files_with_matches") {
        args.push("-l")
    } else if (mode === "count") {
        args.push("-c")
    } else {
        args.push("--line-number", "--no-heading")
    }

    // 追加大小写、glob 及上下文参数
    if (parsed["-i"]) args.push("-i")
    if (parsed.glob) args.push("--glob", parsed.glob)
    if (parsed["-A"] !== undefined) args.push("-A", String(parsed["-A"]))
    if (parsed["-B"] !== undefined) args.push("-B", String(parsed["-B"]))
    if (parsed["-C"] !== undefined) args.push("-C", String(parsed["-C"]))

    args.push(parsed.pattern!, basePath)

    try {
        const proc = Bun.spawn(args, {
            stdout: "pipe",
            stderr: "pipe",
        })
        // 并行收集输出，避免阻塞
        const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ])
        const exitCode = await proc.exited

        // ripgrep 约定：2 表示错误；1 且无输出表示未匹配
        if (exitCode === 2) {
            return `grep 失败(exit=2): ${stderr || stdout}`
        }

        if (exitCode === 1 && !stdout.trim()) {
            return "未找到匹配"
        }

        return stdout || stderr || `命令完成 exit=${exitCode}`
    } catch (err) {
        return `grep 执行失败: ${(err as Error).message}`
    }
}
