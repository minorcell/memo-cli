// 工具相关的类型声明

/** 工具名称枚举，作为 Agent action 中的 tool 字段。 */
export type ToolName = "bash" | "read" | "write" | "edit" | "glob" | "grep" | "fetch"

/** 工具统一签名：字符串入参、Promise 字符串出参。 */
export type ToolFn = (input: string) => Promise<string>
