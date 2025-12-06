import type { ToolFn } from "@memo/tools/tools/types"
import { normalizePath } from "@memo/tools/tools/helpers"

type GlobInput = { pattern?: string; path?: string } | { error: string }

/** 解析 glob 入参，限定 pattern 与 path 的类型。 */
function parseGlobInput(input: string): GlobInput {
    try {
        const parsed = JSON.parse(input)
        if (!parsed?.pattern || typeof parsed.pattern !== "string") {
            return { error: "glob 需要 pattern 字符串" }
        }
        if (parsed.path !== undefined && typeof parsed.path !== "string") {
            return { error: "path 需为字符串" }
        }
        return parsed as GlobInput
    } catch {
        return { error: 'glob 参数需为 JSON，如 {"pattern":"**/*.ts","path":"/repo"}' }
    }
}

/**
 * 扫描目录下符合 pattern 的文件，返回绝对路径列表。
 * 默认在当前工作目录执行，可通过 path 覆盖。
 */
export const glob: ToolFn = async (rawInput: string) => {
    const parsed = parseGlobInput(rawInput.trim())
    if ("error" in parsed) return parsed.error

    const cwd = parsed.path ? normalizePath(parsed.path) : process.cwd()
    // Bun.Glob 按模式扫描匹配
    const globber = new Bun.Glob(parsed.pattern!)
    const matches: string[] = []

    try {
        for await (const file of globber.scan({ cwd })) {
            matches.push(normalizePath(`${cwd}/${file}`))
        }
        return matches.join("\n") || "未找到匹配文件"
    } catch (err) {
        return `glob 失败: ${(err as Error).message}`
    }
}
