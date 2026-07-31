/** @file Approval system constants */

import type { RiskLevel } from './types'

/** Default risk levels for built-in tools. */
export const DEFAULT_TOOL_RISK_LEVELS: Record<string, RiskLevel> = {
    // Read-only tools: no approval in auto mode.
    list_mcp_resources: 'read',
    list_mcp_resource_templates: 'read',
    read_mcp_resource: 'read',
    update_plan: 'read',
    get_memory: 'read',
    webfetch: 'read',
    read_text_file: 'read',
    read_media_file: 'read',
    read_files: 'read',
    list_directory: 'read',
    search_files: 'read',
    wait: 'read',
    spawn_agent: 'read',
    send_input: 'read',
    resume_agent: 'read',
    close_agent: 'read',

    // Write tools: require approval.
    apply_patch: 'write',
    write_file: 'write',
    edit_file: 'write',

    // Execute tools: highest risk, require approval.
    shell: 'execute',
    shell_command: 'execute',
    exec_command: 'execute',
    write_stdin: 'execute',
}

/**
 * Tools that always skip approval checks (even in strict mode).
 * Subagent lifecycle tools should not block the parent flow.
 */
export const ALWAYS_AUTO_APPROVE_TOOLS = new Set<string>([
    'spawn_agent',
    'send_input',
    'resume_agent',
    'wait',
    'close_agent',
])

/** Risk level ordering for comparisons. */
export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
    read: 0,
    write: 1,
    execute: 2,
}

/** Heuristic keywords for unknown tool names. */
export const EXECUTE_RISK_KEYWORDS = ['exec', 'run', 'shell', 'command', 'stdin'] as const
export const WRITE_RISK_KEYWORDS = ['write', 'patch', 'create', 'delete', 'modify', 'update'] as const
export const READ_RISK_KEYWORDS = ['read', 'get', 'fetch', 'search', 'list', 'find'] as const

/** Risk levels that still require approval in auto mode. */
export const AUTO_MODE_APPROVAL_RISKS = new Set<RiskLevel>(['write', 'execute'])
