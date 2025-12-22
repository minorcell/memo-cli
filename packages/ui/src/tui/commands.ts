export type SlashResolveContext = {
    configPath: string
    providerName: string
    model: string
    mcpServerNames: string[]
}

export type SlashCommandResult =
    | { kind: 'exit' }
    | { kind: 'clear' }
    | { kind: 'message'; title: string; content: string }

export function resolveSlashCommand(raw: string, context: SlashResolveContext): SlashCommandResult {
    const [command] = raw.trim().slice(1).split(/\s+/)
    switch (command) {
        case 'exit':
            return { kind: 'exit' }
        case 'clear':
            return { kind: 'clear' }
        case 'history':
            return {
                kind: 'message',
                title: 'history',
                content: '输入 "history" 能够按当前工作目录筛选历史记录并选择回填。',
            }
        default:
            return { kind: 'message', title: 'unknown', content: `Unknown command: ${raw}` }
    }
}
