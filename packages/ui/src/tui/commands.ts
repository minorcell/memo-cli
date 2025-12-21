import { TOOLKIT } from '@memo/tools'
import { HELP_TEXT } from './constants'

export type SlashCommandContext = {
    configPath: string
    providerName: string
    model: string
    mcpServerNames: string[]
}

export type SlashCommandResult =
    | { kind: 'exit' }
    | { kind: 'clear' }
    | { kind: 'message'; title: string; content: string }

export function resolveSlashCommand(
    raw: string,
    context: SlashCommandContext,
): SlashCommandResult {
    const [command] = raw.trim().slice(1).split(/\s+/)
    switch (command) {
        case 'help':
            return { kind: 'message', title: 'help', content: HELP_TEXT }
        case 'exit':
            return { kind: 'exit' }
        case 'clear':
            return { kind: 'clear' }
        case 'tools': {
            const builtin = Object.keys(TOOLKIT).sort()
            const external =
                context.mcpServerNames.length > 0
                    ? `MCP servers: ${context.mcpServerNames.join(', ')}`
                    : 'MCP servers: (none)'
            return {
                kind: 'message',
                title: 'tools',
                content: `Built-in tools (${builtin.length}): ${builtin.join(
                    ', ',
                )}\n${external}`,
            }
        }
        case 'config':
            return {
                kind: 'message',
                title: 'config',
                content: `config: ${context.configPath}\nprovider: ${context.providerName}\nmodel: ${context.model}`,
            }
        default:
            return { kind: 'message', title: 'unknown', content: `Unknown command: ${raw}` }
    }
}
