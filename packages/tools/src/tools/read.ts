import type { ToolFn } from "@memo/tools/tools/types"
import { normalizePath } from "@memo/tools/tools/helpers"

type ReadInput = { file_path?: string; offset?: number; limit?: number } | { error: string }

/** 解析 read 入参，限制偏移与行数为正整数。 */
function parseReadInput(input: string): ReadInput {
    try {
        const parsed = JSON.parse(input)
        if (!parsed?.file_path || typeof parsed.file_path !== "string") {
            return { error: "read 需要 file_path 字符串" }
        }
        if (
            parsed.offset !== undefined &&
            (!Number.isInteger(parsed.offset) || parsed.offset < 1)
        ) {
            return { error: "offset 需为正整数" }
        }
        if (parsed.limit !== undefined && (!Number.isInteger(parsed.limit) || parsed.limit < 1)) {
            return { error: "limit 需为正整数" }
        }
        return parsed as ReadInput
    } catch {
        return { error: 'read 参数需为 JSON，如 {"file_path":"/abs/file","offset":1,"limit":20}' }
    }
}

/**
 * 读取指定文件的部分内容，按行编号返回。
 * 支持 offset/limit 控制起始行与行数，默认为整文件。
 */
export const read: ToolFn = async (rawInput: string) => {
    const parsed = parseReadInput(rawInput.trim())
    if ("error" in parsed) return parsed.error

    const path = normalizePath(parsed.file_path!)
    const offset = parsed.offset ?? 1
    const limit = parsed.limit ?? Number.MAX_SAFE_INTEGER

    try {
        const file = Bun.file(path)
        if (!(await file.exists())) {
            return `文件不存在: ${path}`
        }

        const content = await file.text()
        // 按行切分并截取指定区间
        const lines = content.split(/\r?\n/)
        const startIdx = Math.max(0, offset - 1)
        const endIdx = Math.min(lines.length, startIdx + limit)
        const sliced = lines.slice(startIdx, endIdx)
        // 输出加上行号，便于定位
        const withNumbers = sliced.map((line, i) => `${startIdx + i + 1}: ${line}`).join("\n")
        return withNumbers
    } catch (err) {
        return `读取失败: ${(err as Error).message}`
    }
}
