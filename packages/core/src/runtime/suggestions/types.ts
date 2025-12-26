/** @file 自动补全/建议体系的公共类型定义。 */

export type FileSuggestion = {
    /** 用于 UI key 的唯一 ID，默认等于 path。 */
    id: string
    /** 相对工作目录的 POSIX 风格路径。 */
    path: string
    /** 末级文件/文件夹名。 */
    name: string
    /** 父级路径（若位于根目录则为空）。 */
    parent?: string
    /** 是否为目录，用于区分样式和追加斜杠。 */
    isDir: boolean
}

export type FileSuggestionRequest = {
    cwd: string
    query: string
    limit?: number
    /** 最大递归深度，默认为 6 层。 */
    maxDepth?: number
    /** 单次扫描的最大条目数，默认为 2500。 */
    maxEntries?: number
    /** 是否解析 .gitignore，默认 true。 */
    respectGitIgnore?: boolean
    /** 附加忽略 glob 列表。 */
    ignoreGlobs?: string[]
}

export type InputHistoryEntry = {
    id: string
    cwd: string
    input: string
    ts: number
    sessionFile?: string
}

export type InputHistoryQuery = {
    cwd: string
    keyword?: string
    limit?: number
    /** 仅返回该时间戳之前的记录，用于排除当前 Session。 */
    beforeTs?: number
}

export type InputHistoryStoreOptions = {
    filePath: string
    maxEntries?: number
}
