export type SlashCommandContext = {
    /** 更新输入框内容，并重置历史导航状态。 */
    setInputValue: (next: string) => void
    /** 关闭建议面板，suppress=false 时允许立即重新触发。 */
    closeSuggestions: (suppress?: boolean) => void
    /** 触发外层清屏逻辑。 */
    clearScreen: () => void
    /** 触发退出逻辑。 */
    exitApp: () => void
}

export type SlashCommand = {
    name: string
    description: string
    /** 是否匹配当前关键字，默认走前缀匹配。 */
    matches?: (keyword: string) => boolean
    run: (ctx: SlashCommandContext) => void
}
