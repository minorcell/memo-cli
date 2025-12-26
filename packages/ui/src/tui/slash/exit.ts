import type { SlashCommand } from './types'

export const exitCommand: SlashCommand = {
    name: 'exit',
    description: '退出当前会话',
    run: ({ closeSuggestions, exitApp }) => {
        closeSuggestions()
        exitApp()
    },
}
