/** Shared helpers for MCP CLI commands. */
import { loadMemoConfig, type MCPServerConfig } from '@memo/core'
import type { McpAuthStatus } from '@memo/core/tools/router/mcp/oauth'

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
}

export function parseEnvAssignment(raw: string): { key: string; value: string } | null {
    const index = raw.indexOf('=')
    if (index <= 0) return null
    const key = raw.slice(0, index).trim()
    const value = raw.slice(index + 1)
    if (!key) return null
    return { key, value }
}

export function formatServer(name: string, config: MCPServerConfig, authStatus?: McpAuthStatus): string {
    const lines: string[] = []
    lines.push(`${name}`)
    if (authStatus) lines.push(`  auth_status: ${authStatus}`)
    if ('url' in config) {
        lines.push(`  type: ${config.type ?? 'streamable_http'}`)
        lines.push(`  url: ${config.url}`)
        if (config.bearer_token_env_var) {
            lines.push(`  bearer_token_env_var: ${config.bearer_token_env_var}`)
        }
        const headers = config.http_headers ?? config.headers
        if (headers && Object.keys(headers).length > 0) {
            lines.push(
                `  headers: ${Object.entries(headers)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')}`,
            )
        }
    } else {
        lines.push(`  type: ${config.type ?? 'stdio'}`)
        lines.push(`  command: ${config.command}`)
        if (config.args && config.args.length > 0) {
            lines.push(`  args: ${config.args.join(' ')}`)
        }
        if (config.env && Object.keys(config.env).length > 0) {
            lines.push(
                `  env: ${Object.entries(config.env)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')}`,
            )
        }
    }
    return lines.join('\n')
}

export function oauthSettingsFromLoaded(loaded: Awaited<ReturnType<typeof loadMemoConfig>>) {
    return {
        memoHome: loaded.home,
        storeMode: loaded.config.mcp_oauth_credentials_store_mode,
        callbackPort: loaded.config.mcp_oauth_callback_port,
    }
}
