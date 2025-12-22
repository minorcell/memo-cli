import type { SlashCommand } from './types'

export const clearCommand: SlashCommand = {
    name: 'clear',
    description: '清空屏幕',
    run: ({ closeSuggestions, setInputValue, clearScreen }) => {
        closeSuggestions()
        setInputValue('')
        clearScreen()
    },
}
