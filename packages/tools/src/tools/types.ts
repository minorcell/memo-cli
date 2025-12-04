// 工具相关的类型声明

export type ToolName =
    | "bash"
    | "read"
    | "write"
    | "edit"
    | "glob"
    | "grep"
    | "fetch"

export type ToolFn = (input: string) => Promise<string>
