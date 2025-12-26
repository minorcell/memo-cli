import type { ProviderConfig } from '@memo/core/config/config'

export type SlashResolveContext = {
    configPath: string
    providerName: string
    model: string
    mcpServerNames: string[]
    providers: ProviderConfig[]
}

export type SlashCommandResult =
    | { kind: 'exit' }
    | { kind: 'clear' }
    | { kind: 'message'; title: string; content: string }
    | { kind: 'switch_model'; provider: ProviderConfig }

export function resolveSlashCommand(raw: string, context: SlashResolveContext): SlashCommandResult {
    const [command, ...rest] = raw.trim().slice(1).split(/\s+/)
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
        case 'models': {
            if (!context.providers.length) {
                return {
                    kind: 'message',
                    title: 'models',
                    content: `当前无可用模型，请检查 ${context.configPath} 的 providers 配置。`,
                }
            }
            const query = rest.join(' ').trim()
            const found =
                context.providers.find((p) => p.name === query) ??
                context.providers.find((p) => p.model === query)
            if (found) {
                return { kind: 'switch_model', provider: found }
            }
            const lines = context.providers.map((p) => {
                const baseUrl = p.base_url ? ` @ ${p.base_url}` : ''
                return `- ${p.name}: ${p.model}${baseUrl}`
            })
            const hint = query ? `未找到 ${query}，` : ''
            return {
                kind: 'message',
                title: 'models',
                content: `${hint}可用模型：\n${lines.join('\n')}`,
            }
        }
        default:
            return { kind: 'message', title: 'unknown', content: `Unknown command: ${raw}` }
    }
}
