import type { ProviderConfig, MCPServerConfig } from '@memo/core/config/config'
import type { ToolPermissionMode } from '../../types.js'

export const SLASH_COMMANDS = {
    HELP: 'help',
    EXIT: 'exit',
    NEW: 'new',
    RESUME: 'resume',
    REVIEW: 'review',
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

export function formatSlashCommand(command: SlashCommandName): string {
    return `/${command}`
}

export type SlashContext = {
    configPath: string
    providerName: string
    model: string
    mcpServers: Record<string, MCPServerConfig>
    providers: ProviderConfig[]
    toolPermissionMode: ToolPermissionMode
}

export type SlashCommandResult =
    | { kind: 'exit' }
    | { kind: 'new' }
    | { kind: 'message'; title: string; content: string }
    | { kind: 'review_pr'; prNumber: number }
    | { kind: 'switch_model'; provider: ProviderConfig }
    | { kind: 'set_tool_permission'; mode: ToolPermissionMode }
    | { kind: 'compact' }
    | { kind: 'init_agents_md' }

export type SlashSpec = {
    name: SlashCommandName
    description: string
}
