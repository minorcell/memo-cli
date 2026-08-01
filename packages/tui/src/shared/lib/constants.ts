export const SLASH_COMMANDS = {
    HELP: 'help',
    EXIT: 'exit',
    NEW: 'new',
    RESUME: 'resume',
    MODELS: 'models',
    TOOLS: 'tools',
    COMPACT: 'compact',
    MCP: 'mcp',
    INIT: 'init',
} as const

export type SlashCommandName = (typeof SLASH_COMMANDS)[keyof typeof SLASH_COMMANDS]

export const TOOL_PERMISSION_MODES = {
    NONE: 'none',
    ONCE: 'once',
    FULL: 'full',
} as const

export type ToolPermissionMode = (typeof TOOL_PERMISSION_MODES)[keyof typeof TOOL_PERMISSION_MODES]

export function formatSlashCommand(command: SlashCommandName): string {
    return `/${command}`
}

export const PLAIN_EXIT_COMMAND = 'exit' as const
