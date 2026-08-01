import type { SlashCommandResult, SlashContext, SlashSpec } from './types'
import { formatSlashCommand, SLASH_COMMANDS, TOOL_PERMISSION_MODES } from './types'
import type { ToolPermissionMode } from '../../types.js'

export const SLASH_SPECS: SlashSpec[] = [
    { name: SLASH_COMMANDS.HELP, description: 'Show command and shortcut help' },
    { name: SLASH_COMMANDS.EXIT, description: 'Exit current session' },
    { name: SLASH_COMMANDS.NEW, description: 'Start a fresh session' },
    { name: SLASH_COMMANDS.RESUME, description: 'List and load session history' },
    { name: SLASH_COMMANDS.MODELS, description: 'List or switch configured models' },
    {
        name: SLASH_COMMANDS.TOOLS,
        description: 'Set tool permission mode (none/once/full)',
    },
    { name: SLASH_COMMANDS.COMPACT, description: 'Compact conversation context now' },
    { name: SLASH_COMMANDS.MCP, description: 'Show configured MCP servers' },
    { name: SLASH_COMMANDS.INIT, description: 'Generate AGENTS.md with agent instructions' },
]

const TOOL_PERMISSION_MODE_ALIASES: Record<string, ToolPermissionMode> = {
    none: TOOL_PERMISSION_MODES.NONE,
    off: TOOL_PERMISSION_MODES.NONE,
    disabled: TOOL_PERMISSION_MODES.NONE,
    'no-tools': TOOL_PERMISSION_MODES.NONE,
    once: TOOL_PERMISSION_MODES.ONCE,
    ask: TOOL_PERMISSION_MODES.ONCE,
    single: TOOL_PERMISSION_MODES.ONCE,
    strict: TOOL_PERMISSION_MODES.ONCE,
    full: TOOL_PERMISSION_MODES.FULL,
    all: TOOL_PERMISSION_MODES.FULL,
    dangerous: TOOL_PERMISSION_MODES.FULL,
    'full-access': TOOL_PERMISSION_MODES.FULL,
}

function parseToolPermissionMode(input: string | undefined): ToolPermissionMode | null {
    if (!input) return null
    const normalized = input.trim().toLowerCase()
    if (!normalized) return null
    return TOOL_PERMISSION_MODE_ALIASES[normalized] ?? null
}

function toolPermissionLabel(mode: ToolPermissionMode): string {
    if (mode === TOOL_PERMISSION_MODES.NONE) return 'none (no tools)'
    if (mode === TOOL_PERMISSION_MODES.ONCE) return 'once (approval required)'
    return 'full (no approval)'
}

export function buildHelpText(): string {
    const maxName = SLASH_SPECS.reduce((max, item) => Math.max(max, item.name.length), 0)
    const commandLines = SLASH_SPECS.map(
        (item) => `  ${formatSlashCommand(item.name).padEnd(maxName + 3)}  ${item.description}`,
    )

    return [
        'Available commands:',
        ...commandLines,
        '  exit        Exit session (without slash)',
        '',
        'Shortcuts:',
        '  Enter       Send message',
        '  Shift+Enter New line',
        '  Up/Down     Browse local input history',
        '  Tab         Accept active suggestion',
        '  Ctrl+L      Clear screen and start new session',
        '  Esc×2       Interrupt running turn / clear input',
    ].join('\n')
}

export function resolveSlashCommand(raw: string, context: SlashContext): SlashCommandResult {
    const [commandRaw, ...rest] = raw.trim().slice(1).split(/\s+/)
    const command = (commandRaw ?? '').toLowerCase()

    switch (command) {
        case SLASH_COMMANDS.HELP:
            return { kind: 'message', title: 'Help', content: buildHelpText() }

        case SLASH_COMMANDS.EXIT:
            return { kind: 'exit' }

        case SLASH_COMMANDS.NEW:
            return { kind: 'new' }

        case SLASH_COMMANDS.RESUME:
            return {
                kind: 'message',
                title: 'Resume',
                content: 'Type "resume" followed by keywords to load local session history.',
            }

        case SLASH_COMMANDS.MODELS: {
            if (!context.providers.length) {
                return {
                    kind: 'message',
                    title: 'Models',
                    content: `No providers configured. Check ${context.configPath}`,
                }
            }

            const query = rest.join(' ').trim()
            const found =
                context.providers.find((provider) => provider.name === query) ??
                context.providers.find((provider) => provider.model === query)

            if (found) {
                return { kind: 'switch_model', provider: found }
            }

            const lines = context.providers.map((provider) => {
                const marker =
                    provider.name === context.providerName && provider.model === context.model ? ' (current)' : ''
                const base = provider.base_url ? ` @ ${provider.base_url}` : ''
                return `- ${provider.name}: ${provider.model}${base}${marker}`
            })

            const prefix = query ? `Not found: ${query}\n\n` : ''
            return {
                kind: 'message',
                title: 'Models',
                content: `${prefix}${lines.join('\n')}`,
            }
        }

        case SLASH_COMMANDS.TOOLS: {
            const rawMode = rest.join(' ').trim()
            const parsedMode = parseToolPermissionMode(rawMode)
            const options = ['none', 'once', 'full'].join(', ')

            if (!rawMode) {
                return {
                    kind: 'message',
                    title: 'Tools',
                    content: `Current: ${toolPermissionLabel(context.toolPermissionMode)}\nUsage: ${formatSlashCommand(SLASH_COMMANDS.TOOLS)} <mode>\nModes: ${options}`,
                }
            }

            if (!parsedMode) {
                return {
                    kind: 'message',
                    title: 'Tools',
                    content: `Unsupported mode: ${rawMode}\nChoose one of: ${options}`,
                }
            }

            if (parsedMode === context.toolPermissionMode) {
                return {
                    kind: 'message',
                    title: 'Tools',
                    content: `Already using ${toolPermissionLabel(parsedMode)}.`,
                }
            }

            return {
                kind: 'set_tool_permission',
                mode: parsedMode,
            }
        }

        case SLASH_COMMANDS.COMPACT:
            return { kind: 'compact' }

        case SLASH_COMMANDS.MCP: {
            const names = Object.keys(context.mcpServers)
            if (!names.length) {
                return {
                    kind: 'message',
                    title: 'MCP Servers',
                    content: 'No MCP servers configured in current config.',
                }
            }

            const lines: string[] = []
            lines.push(`Total: ${names.length}`)
            lines.push('')

            for (const [name, server] of Object.entries(context.mcpServers)) {
                lines.push(`- ${name}`)
                if ('url' in server) {
                    lines.push(`  type: ${server.type ?? 'streamable_http'}`)
                    lines.push(`  url: ${server.url}`)
                    if (server.bearer_token_env_var) {
                        lines.push(`  bearer: ${server.bearer_token_env_var}`)
                    }
                } else {
                    lines.push(`  type: ${server.type ?? 'stdio'}`)
                    lines.push(`  command: ${server.command}`)
                    if (server.args?.length) {
                        lines.push(`  args: ${server.args.join(' ')}`)
                    }
                }
                lines.push('')
            }

            return {
                kind: 'message',
                title: 'MCP Servers',
                content: lines.join('\n'),
            }
        }

        case SLASH_COMMANDS.INIT:
            return { kind: 'init_agents_md' }

        default:
            return {
                kind: 'message',
                title: 'Unknown',
                content: `Unknown command: ${raw}\nType ${formatSlashCommand(SLASH_COMMANDS.HELP)} for available commands.`,
            }
    }
}
