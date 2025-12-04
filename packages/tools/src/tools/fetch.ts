import type { ToolFn } from "@memo/tools/tools/types"

export const fetchUrl: ToolFn = async (rawUrl: string) => {
    const url = rawUrl.trim()
    if (!url) return "fetch 需要 URL"
    try {
        const res = await globalThis.fetch(url)
        const body = await res.text()
        return `status=${res.status} length=${body.length} body="${body}"`
    } catch (err) {
        return `请求失败: ${(err as Error).message}`
    }
}
