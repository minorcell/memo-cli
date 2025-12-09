// 声明提示词等文本导入的模块类型，便于在 TS 中直接 import 文本。
declare module '*.md' {
    const content: string
    export default content
}
