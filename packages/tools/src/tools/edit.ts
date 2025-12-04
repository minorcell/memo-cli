import { writeFile } from "node:fs/promises"
import type { ToolFn } from "@memo/tools/tools/types"
import { ensureParentDir, normalizePath } from "@memo/tools/tools/helpers"

type EditInput =
    | {
          file_path?: string
          old_string?: string
          new_string?: string
          replace_all?: boolean
      }
    | { error: string }

function parseEditInput(input: string): EditInput {
    try {
        const parsed = JSON.parse(input)
        if (!parsed?.file_path || typeof parsed.file_path !== "string") {
            return { error: "edit 需要 file_path 字符串" }
        }
        if (typeof parsed.old_string !== "string") {
            return { error: "edit 需要 old_string 字符串" }
        }
        if (typeof parsed.new_string !== "string") {
            return { error: "edit 需要 new_string 字符串" }
        }
        if (
            parsed.replace_all !== undefined &&
            typeof parsed.replace_all !== "boolean"
        ) {
            return { error: "replace_all 需为布尔值" }
        }
        return parsed as EditInput
    } catch {
        return {
            error:
                'edit 参数需为 JSON，如 {"file_path":"/abs/file","old_string":"a","new_string":"b","replace_all":false}',
        }
    }
}

export const edit: ToolFn = async (rawInput: string) => {
    const parsed = parseEditInput(rawInput.trim())
    if ("error" in parsed) return parsed.error

    const path = normalizePath(parsed.file_path!)
    const replaceAll = parsed.replace_all ?? false

    try {
        const file = Bun.file(path)
        if (!(await file.exists())) {
            return `文件不存在: ${path}`
        }
        const original = await file.text()

        if (!original.includes(parsed.old_string!)) {
            return "未找到待替换文本"
        }

        let replaced: string
        let count = 0
        if (replaceAll) {
            const parts = original.split(parsed.old_string!)
            count = parts.length - 1
            replaced = parts.join(parsed.new_string!)
        } else {
            replaced = original.replace(parsed.old_string!, parsed.new_string!)
            count = 1
        }

        if (replaced === original) {
            return "未检测到内容变化"
        }

        await ensureParentDir(path)
        await writeFile(path, replaced, { encoding: "utf8" })
        return `替换完成: file=${path} count=${count}`
    } catch (err) {
        return `edit 失败: ${(err as Error).message}`
    }
}
