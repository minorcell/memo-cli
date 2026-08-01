import assert from 'node:assert'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { MCPServerConfig } from '../types'

const {
    toolsMock,
    createClientConfigMock,
    closeMock,
    createRuntimeMcpOAuthProviderMock,
    stdioInstances,
    UnauthorizedErrorMock,
} = vi.hoisted(() => {
    class UnauthorizedErrorMock extends Error {}
    return {
        toolsMock: vi.fn(),
        createClientConfigMock: vi.fn(),
        closeMock: vi.fn(),
        createRuntimeMcpOAuthProviderMock: vi.fn(),
        stdioInstances: [] as Array<{ options: Record<string, unknown> }>,
        UnauthorizedErrorMock,
    }
})

vi.mock('@ai-sdk/mcp', async () => {
    const actual = await vi.importActual('@ai-sdk/mcp')
    return {
        ...(actual as Record<string, unknown>),
        createMCPClient: async (config: unknown) => {
            await createClientConfigMock(config)
            return {
                tools: async () => toolsMock(),
                close: async () => closeMock(),
            }
        },
        UnauthorizedError: UnauthorizedErrorMock,
    }
})

vi.mock('@ai-sdk/mcp/mcp-stdio', () => {
    class MockStdioMCPTransport {
        options: Record<string, unknown>
        constructor(options: Record<string, unknown>) {
            this.options = options
            stdioInstances.push(this)
        }
    }
    return {
        Experimental_StdioMCPTransport: MockStdioMCPTransport,
    }
})

vi.mock('./oauth', () => {
    return {
        createRuntimeMcpOAuthProvider: createRuntimeMcpOAuthProviderMock,
    }
})

import { McpClientPool } from './pool'

function httpConfig(extra?: Partial<Extract<MCPServerConfig, { url: string }>>): MCPServerConfig {
    return {
        type: 'streamable_http',
        url: 'https://example.com/mcp',
        ...extra,
    }
}

describe('mcp client pool', () => {
    afterEach(() => {
        toolsMock.mockReset()
        createClientConfigMock.mockReset()
        closeMock.mockReset()
        createRuntimeMcpOAuthProviderMock.mockReset()
        stdioInstances.splice(0)
        delete process.env.MCP_TOKEN
    })

    test('connects HTTP server with oauth settings and request headers', async () => {
        const authProvider = { kind: 'oauth-provider' }
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(authProvider)
        toolsMock.mockResolvedValue({
            search: { description: 'Search docs', inputSchema: { type: 'object' } },
        })
        process.env.MCP_TOKEN = 'token-123'

        const pool = new McpClientPool()
        const config = httpConfig({
            headers: { 'X-Custom': 'value' },
            bearer_token_env_var: 'MCP_TOKEN',
        })
        pool.setServerConfigs(
            { remote: config },
            { memoHome: '/tmp/memo-home', storeMode: 'file', callbackPort: 33333 },
        )

        const connection = await pool.connect('remote')

        expect(createRuntimeMcpOAuthProviderMock).toHaveBeenCalledWith({
            serverName: 'remote',
            config,
            settings: { memoHome: '/tmp/memo-home', storeMode: 'file', callbackPort: 33333 },
        })
        expect(createClientConfigMock).toHaveBeenCalledTimes(1)
        const transportConfig = createClientConfigMock.mock.calls[0]?.[0] as {
            transport: { type: string; url: string; headers: Record<string, string>; authProvider: unknown }
        }
        assert.strictEqual(transportConfig.transport.type, 'http')
        assert.strictEqual(transportConfig.transport.url, 'https://example.com/mcp')
        expect(transportConfig.transport.authProvider).toEqual(authProvider)
        expect(transportConfig.transport.headers).toEqual({
            'X-Custom': 'value',
            Authorization: 'Bearer token-123',
        })
        assert.strictEqual(Object.keys(connection.tools).length, 1)
        assert.ok(connection.tools['search'])
    })

    test('reuses inflight connect promise for same server', async () => {
        let resolveConnect!: () => void
        const connectPromise = new Promise<void>((resolve) => {
            resolveConnect = resolve
        })
        createClientConfigMock.mockImplementation(() => connectPromise)
        toolsMock.mockResolvedValue({})
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()
        const config = httpConfig()

        const first = pool.connect('remote', config)
        const second = pool.connect('remote')

        resolveConnect()
        const [left, right] = await Promise.all([first, second])

        expect(createClientConfigMock).toHaveBeenCalledTimes(1)
        assert.strictEqual(left, right)
    })

    test('includes login hint for unauthorized HTTP failures', async () => {
        createClientConfigMock.mockRejectedValue(new UnauthorizedErrorMock('unauthorized'))
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()
        await expect(pool.connect('remote', httpConfig())).rejects.toThrow('Run "memo mcp login remote".')
    })

    test('does not include login hint for non-auth failures', async () => {
        createClientConfigMock.mockRejectedValue(new Error('connection refused'))
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()
        await expect(pool.connect('remote', httpConfig())).rejects.toThrow(
            'Failed to connect via streamable_http (connection refused).',
        )
    })

    test('closes client when listing tools fails', async () => {
        toolsMock.mockRejectedValue(new Error('list failed'))
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()
        await expect(pool.connect('remote', httpConfig())).rejects.toThrow('list failed')
        expect(closeMock).toHaveBeenCalledTimes(1)
    })

    test('connects stdio server with merged env and explicit stderr mode', async () => {
        toolsMock.mockResolvedValue({})
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)
        process.env.BASE_ENV = 'base'

        const pool = new McpClientPool()
        await pool.connect('remote', {
            command: 'node',
            args: ['server.js'],
            env: { LOCAL_ENV: 'local' },
            stderr: 'pipe',
        })

        assert.strictEqual(stdioInstances.length, 1)
        const transport = stdioInstances[0]
        assert.strictEqual(transport?.options.command, 'node')
        expect(transport?.options.args).toEqual(['server.js'])
        assert.strictEqual(transport?.options.stderr, 'pipe')
        const env = transport?.options.env as Record<string, string>
        assert.strictEqual(env.LOCAL_ENV, 'local')
        assert.strictEqual(env.BASE_ENV, 'base')
    })

    test('closeAll logs close failures and clears connected clients', async () => {
        toolsMock.mockResolvedValue({})
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)
        closeMock.mockRejectedValue(new Error('close failed'))
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const pool = new McpClientPool()
        await pool.connect('remote', httpConfig())
        assert.strictEqual(pool.size, 1)

        await pool.closeAll()
        assert.strictEqual(pool.size, 0)
        expect(consoleSpy).toHaveBeenCalled()
        consoleSpy.mockRestore()
    })

    test('tracks known servers from configs and active connections', async () => {
        toolsMock.mockResolvedValue({})
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()
        pool.setServerConfigs({ configured: httpConfig() })
        await pool.connect('connected', httpConfig())

        assert.strictEqual(pool.hasServer('configured'), true)
        assert.strictEqual(pool.hasServer('connected'), true)
        const names = pool.getKnownServerNames()
        expect(names).toContain('configured')
        expect(names).toContain('connected')
    })
})
