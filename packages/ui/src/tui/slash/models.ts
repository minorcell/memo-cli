import type { SlashCommand } from './types'

export const modelsCommand: SlashCommand = {
    name: 'models',
    description: '选择模型（展示配置里的 providers）',
    run: ({ closeSuggestions, setInputValue }) => {
        closeSuggestions(false)
        setInputValue('/models ')
    },
}
