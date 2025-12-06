import type { ToolFn } from "@memo/tools/tools/types"
import { normalizePath } from "@memo/tools/tools/helpers"

type EditInput =
    | {
          file_path?: string
          old_string?: string
          new_string?: string
          replace_all?: boolean
      }
    | { error: string }

/**
 * 解析并校验 edit 入参，确保路径与替换文本有效。
 */
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
        if (parsed.replace_all !== undefined && typeof parsed.replace_all !== "boolean") {
            return { error: "replace_all 需为布尔值" }
        }
        return parsed as EditInput
    } catch {
        return {
            error: 'edit 参数需为 JSON，如 {"file_path":"/abs/file","old_string":"a","new_string":"b","replace_all":false}',
        }
    }
}

/**
 * 根据入参在目标文件中替换文本，支持单次或全局替换。
 * 返回替换数量及文件路径，若未找到或未变更会返回提示语。
 */
export const edit: ToolFn = async (rawInput: string) => {
    const parsed = parseEditInput(rawInput.trim())
    if ("error" in parsed) return parsed.error

    const path = normalizePath(parsed.file_path!) // 统一为绝对路径，避免相对路径混淆
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
            // 全局替换：拆分再拼接统计替换次数
            const parts = original.split(parsed.old_string!)
            count = parts.length - 1
            replaced = parts.join(parsed.new_string!)
        } else {
            // 单次替换：只替换首个匹配
            replaced = original.replace(parsed.old_string!, parsed.new_string!)
            count = 1
        }

        if (replaced === original) {
            return "未检测到内容变化"
        }

        // 持久化写回文件，Bun.write 会自动创建父目录
        await Bun.write(path, replaced)
        return `替换完成: file=${path} count=${count}`
    } catch (err) {
        return `edit 失败: ${(err as Error).message}`
    }
}
