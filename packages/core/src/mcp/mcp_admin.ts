import { loadMemoConfig, writeMemoConfig, type MCPServerConfig, type MemoConfig } from '@memo/core/config/config'
import {
    getMcpAuthStatus,
    loginMcpServerOAuth,
    logoutMcpServerOAuth,
    type McpAuthStatus,
} from '@memo/tools/router/mcp/oauth'
import type { McpServerRecord } from '../api_types.js'

export class McpAdminError extends Error {
    constructor(
        readonly code: 'BAD_REQUEST' | 'NOT_FOUND',
        message: string,
    ) {
        super(message)
    }
}

function ensureName(name: string): string {
    const normalized = name.trim()
    if (!normalized) {
        throw new McpAdminError('BAD_REQUEST', 'name is required')
    }
    return normalized
}

function parseMcpServerConfig(input: unknown): MCPServerConfig {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new McpAdminError('BAD_REQUEST', 'config is required')
    }
    const config = input as Record<string, unknown>

    if (typeof config.url === 'string' && config.url.trim()) {
        return {
            type: 'streamable_http',
            url: config.url.trim(),
            bearer_token_env_var:
                typeof config.bearer_token_env_var === 'string' && config.bearer_token_env_var.trim()
                    ? config.bearer_token_env_var.trim()
                    : undefined,
            headers:
                config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)
                    ? (config.headers as Record<string, string>)
                    : undefined,
            http_headers:
                config.http_headers && typeof config.http_headers === 'object' && !Array.isArray(config.http_headers)
                    ? (config.http_headers as Record<string, string>)
                    : undefined,
        }
    }

    if (typeof config.command === 'string' && config.command.trim()) {
        return {
            type: 'stdio',
            command: config.command.trim(),
            args: Array.isArray(config.args)
                ? config.args
                      .filter((item): item is string => typeof item === 'string')
                      .map((item) => item.trim())
                      .filter(Boolean)
                : undefined,
            env:
                config.env && typeof config.env === 'object' && !Array.isArray(config.env)
                    ? (config.env as Record<string, string>)
                    : undefined,
            stderr:
                config.stderr === 'inherit' || config.stderr === 'pipe' || config.stderr === 'ignore'
                    ? config.stderr
                    : undefined,
        }
    }

    throw new McpAdminError('BAD_REQUEST', 'config must include url or command')
}

function normalizeConfig(config: MemoConfig): MemoConfig {
    return {
        ...config,
        mcp_servers: config.mcp_servers ?? {},
        active_mcp_servers: config.active_mcp_servers ?? [],
    }
}

async function loadNormalizedConfig() {
    const loaded = await loadMemoConfig()
    return {
        ...loaded,
        config: normalizeConfig(loaded.config),
    }
}

async function persistConfig(configPath: string, config: MemoConfig): Promise<void> {
    await writeMemoConfig(configPath, config)
}

function toRecord(
    name: string,
    config: MCPServerConfig,
    activeNames: Set<string>,
    authStatus: McpAuthStatus,
): McpServerRecord {
    return {
        name,
        config,
        authStatus,
        active: activeNames.has(name),
    }
}

export async function listMcpServers(): Promise<{ items: McpServerRecord[] }> {
    const loaded = await loadNormalizedConfig()
    const settings = {
        memoHome: loaded.home,
        storeMode: loaded.config.mcp_oauth_credentials_store_mode,
        callbackPort: loaded.config.mcp_oauth_callback_port,
    }
    const activeNames = new Set(loaded.config.active_mcp_servers ?? [])
    const items: McpServerRecord[] = []

    for (const [name, config] of Object.entries(loaded.config.mcp_servers ?? {})) {
        let authStatus: McpAuthStatus = 'unsupported'
        try {
            authStatus = await getMcpAuthStatus(config, settings)
        } catch {
            authStatus = 'unsupported'
        }
        items.push(toRecord(name, config, activeNames, authStatus))
    }

    items.sort((a, b) => a.name.localeCompare(b.name))
    return { items }
}

export async function getMcpServer(name: string): Promise<McpServerRecord> {
    const target = ensureName(name)
    const list = await listMcpServers()
    const found = list.items.find((item) => item.name === target)
    if (!found) {
        throw new McpAdminError('NOT_FOUND', 'MCP server not found')
    }
    return found
}

export async function createMcpServer(name: string, configInput: unknown): Promise<{ created: true }> {
    const target = ensureName(name)
    const nextConfig = parseMcpServerConfig(configInput)
    const loaded = await loadNormalizedConfig()
    const current = loaded.config.mcp_servers ?? {}
    if (current[target]) {
        throw new McpAdminError('BAD_REQUEST', `MCP server already exists: ${target}`)
    }

    const merged: MemoConfig = {
        ...loaded.config,
        mcp_servers: {
            ...current,
            [target]: nextConfig,
        },
    }
    await persistConfig(loaded.configPath, merged)
    return { created: true }
}

export async function updateMcpServer(name: string, configInput: unknown): Promise<{ updated: true }> {
    const target = ensureName(name)
    const nextConfig = parseMcpServerConfig(configInput)
    const loaded = await loadNormalizedConfig()
    const current = loaded.config.mcp_servers ?? {}
    if (!current[target]) {
        throw new McpAdminError('NOT_FOUND', 'MCP server not found')
    }

    const merged: MemoConfig = {
        ...loaded.config,
        mcp_servers: {
            ...current,
            [target]: nextConfig,
        },
    }
    await persistConfig(loaded.configPath, merged)
    return { updated: true }
}

export async function removeMcpServer(name: string): Promise<{ deleted: true }> {
    const target = ensureName(name)
    const loaded = await loadNormalizedConfig()
    const current = loaded.config.mcp_servers ?? {}
    if (!current[target]) {
        throw new McpAdminError('NOT_FOUND', 'MCP server not found')
    }

    const nextServers = { ...current }
    delete nextServers[target]
    const nextActive = (loaded.config.active_mcp_servers ?? []).filter((item) => item !== target)

    const merged: MemoConfig = {
        ...loaded.config,
        mcp_servers: nextServers,
        active_mcp_servers: nextActive,
    }
    await persistConfig(loaded.configPath, merged)
    return { deleted: true }
}

export async function loginMcpServer(name: string, scopes: string[] | undefined): Promise<{ loggedIn: true }> {
    const target = ensureName(name)
    const loaded = await loadNormalizedConfig()
    const config = loaded.config.mcp_servers?.[target]
    if (!config) {
        throw new McpAdminError('NOT_FOUND', 'MCP server not found')
    }
    if (!('url' in config)) {
        throw new McpAdminError('BAD_REQUEST', 'OAuth login is only supported for HTTP MCP servers')
    }
    await loginMcpServerOAuth({
        serverName: target,
        config,
        scopes,
        settings: {
            memoHome: loaded.home,
            storeMode: loaded.config.mcp_oauth_credentials_store_mode,
            callbackPort: loaded.config.mcp_oauth_callback_port,
        },
    })
    return { loggedIn: true }
}

export async function logoutMcpServer(name: string): Promise<{ loggedOut: true }> {
    const target = ensureName(name)
    const loaded = await loadNormalizedConfig()
    const config = loaded.config.mcp_servers?.[target]
    if (!config) {
        throw new McpAdminError('NOT_FOUND', 'MCP server not found')
    }
    if (!('url' in config)) {
        throw new McpAdminError('BAD_REQUEST', 'OAuth logout is only supported for HTTP MCP servers')
    }
    await logoutMcpServerOAuth({
        config,
        settings: {
            memoHome: loaded.home,
            storeMode: loaded.config.mcp_oauth_credentials_store_mode,
        },
    })
    return { loggedOut: true }
}

export async function setActiveMcpServers(names: string[]): Promise<{ active: string[] }> {
    const loaded = await loadNormalizedConfig()
    const unique = Array.from(
        new Set(
            names
                .filter((item): item is string => typeof item === 'string')
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    )
    const known = new Set(Object.keys(loaded.config.mcp_servers ?? {}))
    const active = unique.filter((name) => known.has(name))

    const merged: MemoConfig = {
        ...loaded.config,
        active_mcp_servers: active,
    }
    await persistConfig(loaded.configPath, merged)
    return { active }
}
