import assert from 'node:assert'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { MemoConfig } from '@memo/core/config/config'

const mocks = vi.hoisted(() => ({
    loadMemoConfig: vi.fn(),
    writeMemoConfig: vi.fn(),
    getMcpAuthStatus: vi.fn(),
    loginMcpServerOAuth: vi.fn(),
    logoutMcpServerOAuth: vi.fn(),
}))

vi.mock('@memo/core/config/config', () => ({
    loadMemoConfig: mocks.loadMemoConfig,
    writeMemoConfig: mocks.writeMemoConfig,
}))

vi.mock('@memo/core/tools/router/mcp/oauth', () => ({
    getMcpAuthStatus: mocks.getMcpAuthStatus,
    loginMcpServerOAuth: mocks.loginMcpServerOAuth,
    logoutMcpServerOAuth: mocks.logoutMcpServerOAuth,
}))

import {
    McpAdminError,
    createMcpServer,
    getMcpServer,
    listMcpServers,
    loginMcpServer,
    logoutMcpServer,
    removeMcpServer,
    setActiveMcpServers,
    updateMcpServer,
} from './mcp_admin'

type LoadedState = {
    configPath: string
    home: string
    config: MemoConfig
    needsSetup: boolean
}

let state: LoadedState

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

beforeEach(() => {
    vi.clearAllMocks()
    state = {
        configPath: '/tmp/.memo/config.toml',
        home: '/tmp/.memo',
        needsSetup: false,
        config: {
            current_provider: 'openai',
            providers: [
                {
                    name: 'openai',
                    env_api_key: 'OPENAI_API_KEY',
                    model: 'gpt-4.1-mini',
                },
            ],
            mcp_servers: {},
            active_mcp_servers: [],
            mcp_oauth_credentials_store_mode: 'file',
            mcp_oauth_callback_port: 33000,
        },
    }

    mocks.loadMemoConfig.mockImplementation(async () => clone(state))
    mocks.writeMemoConfig.mockImplementation(async (_path: string, config: MemoConfig) => {
        state = {
            ...state,
            config: clone(config),
        }
    })
    mocks.getMcpAuthStatus.mockResolvedValue('not_logged_in')
    mocks.loginMcpServerOAuth.mockResolvedValue(undefined)
    mocks.logoutMcpServerOAuth.mockResolvedValue(undefined)
})

describe('mcp_admin', () => {
    test('lists servers sorted and tolerates auth status errors', async () => {
        state.config.mcp_servers = {
            zebra: { command: 'node', args: ['z.js'] },
            alpha: { url: 'https://example.com/mcp' },
        }
        state.config.active_mcp_servers = ['alpha']

        mocks.getMcpAuthStatus.mockImplementation(async (config: Record<string, unknown>) => {
            if ('url' in config) return 'oauth'
            throw new Error('status failure')
        })

        const result = await listMcpServers()
        assert.deepStrictEqual(
            result.items.map((item) => item.name),
            ['alpha', 'zebra'],
        )
        assert.strictEqual(result.items[0]?.authStatus, 'oauth')
        assert.strictEqual(result.items[0]?.active, true)
        assert.strictEqual(result.items[1]?.authStatus, 'unsupported')
    })

    test('creates, gets, updates and removes servers', async () => {
        await createMcpServer('remote', {
            url: ' https://example.com/mcp ',
            bearer_token_env_var: ' MCP_TOKEN ',
            headers: { Authorization: 'Bearer token' },
        })
        await createMcpServer('local', {
            command: ' node ',
            args: ['  server.js ', 123, ' --debug '],
            stderr: 'pipe',
            env: { FOO: 'bar' },
        })

        const remote = await getMcpServer('remote')
        assert.strictEqual(remote.name, 'remote')
        assert.strictEqual('url' in remote.config, true)

        await updateMcpServer('local', {
            command: 'deno',
            args: ['run', 'main.ts'],
            stderr: 'ignore',
        })

        const local = await getMcpServer('local')
        assert.strictEqual('command' in local.config, true)
        if ('command' in local.config) {
            assert.strictEqual(local.config.command, 'deno')
            assert.deepStrictEqual(local.config.args, ['run', 'main.ts'])
            assert.strictEqual(local.config.stderr, 'ignore')
        }

        state.config.active_mcp_servers = ['remote', 'local']
        await removeMcpServer('remote')
        assert.ok(!state.config.mcp_servers?.remote)
        assert.deepStrictEqual(state.config.active_mcp_servers, ['local'])
    })

    test('handles invalid inputs and not-found branches', async () => {
        await expect(createMcpServer('x', null)).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        })
        await expect(createMcpServer('x', { foo: 'bar' })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        })

        await createMcpServer('dup', { command: 'node' })
        await expect(createMcpServer('dup', { command: 'node' })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        })

        await expect(getMcpServer('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
        await expect(updateMcpServer('missing', { command: 'node' })).rejects.toMatchObject({
            code: 'NOT_FOUND',
        })
        await expect(removeMcpServer('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })

        await expect(createMcpServer('   ', { command: 'node' })).rejects.toBeInstanceOf(McpAdminError)
    })

    test('login/logout enforce server type and forward oauth settings', async () => {
        state.config.mcp_servers = {
            remote: { url: 'https://example.com/mcp' },
            local: { command: 'node', args: ['server.js'] },
        }

        await expect(loginMcpServer('missing', undefined)).rejects.toMatchObject({
            code: 'NOT_FOUND',
        })
        await expect(logoutMcpServer('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })

        await expect(loginMcpServer('local', ['read'])).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        })
        await expect(logoutMcpServer('local')).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        })

        await loginMcpServer('remote', ['read', 'write'])
        expect(mocks.loginMcpServerOAuth).toHaveBeenCalledWith({
            serverName: 'remote',
            config: { url: 'https://example.com/mcp' },
            scopes: ['read', 'write'],
            settings: {
                memoHome: '/tmp/.memo',
                storeMode: 'file',
                callbackPort: 33000,
            },
        })

        await logoutMcpServer('remote')
        expect(mocks.logoutMcpServerOAuth).toHaveBeenCalledWith({
            config: { url: 'https://example.com/mcp' },
            settings: {
                memoHome: '/tmp/.memo',
                storeMode: 'file',
            },
        })
    })

    test('setActiveMcpServers keeps only known unique names', async () => {
        state.config.mcp_servers = {
            remote: { url: 'https://example.com/mcp' },
            local: { command: 'node' },
        }

        const result = await setActiveMcpServers(['remote', 'remote', 'unknown', ' local ', '', '   '])

        assert.deepStrictEqual(result.active, ['remote', 'local'])
        assert.deepStrictEqual(state.config.active_mcp_servers, ['remote', 'local'])
    })
})
