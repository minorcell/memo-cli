import type { SlashCommand } from './types'

export const historyCommand: SlashCommand = {
    name: 'history',
    description: '查看历史输入',
    run: ({ setInputValue, closeSuggestions }) => {
        closeSuggestions(false)
        setInputValue('history ')
    },
}
