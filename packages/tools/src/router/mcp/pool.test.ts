import assert from 'node:assert'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { MCPServerConfig } from '../types'

const {
    connectMock,
    listToolsMock,
    closeMock,
    createRuntimeMcpOAuthProviderMock,
    streamableInstances,
    stdioInstances,
    UnauthorizedErrorMock,
    StreamableHTTPErrorMock,
} = vi.hoisted(() => {
    class UnauthorizedErrorMock extends Error {}
    class StreamableHTTPErrorMock extends Error {
        code: number
        constructor(message: string, code: number) {
            super(message)
            this.code = code
        }
    }
    return {
        connectMock: vi.fn(),
        listToolsMock: vi.fn(),
        closeMock: vi.fn(),
        createRuntimeMcpOAuthProviderMock: vi.fn(),
        streamableInstances: [] as Array<{ url: URL; options: Record<string, unknown> }>,
        stdioInstances: [] as Array<{ options: Record<string, unknown> }>,
        UnauthorizedErrorMock,
        StreamableHTTPErrorMock,
    }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
    class MockClient {
        async connect(transport: unknown) {
            return connectMock(transport)
        }
        async listTools() {
            return listToolsMock()
        }
        async close() {
            return closeMock()
        }
    }
    return {
        Client: MockClient,
    }
})

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
    class MockStreamableHTTPClientTransport {
        url: URL
        options: Record<string, unknown>
        constructor(url: URL, options: Record<string, unknown>) {
            this.url = url
            this.options = options
            streamableInstances.push(this)
        }
    }
    return {
        StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
        StreamableHTTPError: StreamableHTTPErrorMock,
    }
})

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
    class MockStdioClientTransport {
        options: Record<string, unknown>
        constructor(options: Record<string, unknown>) {
            this.options = options
            stdioInstances.push(this)
        }
    }
    return {
        StdioClientTransport: MockStdioClientTransport,
    }
})

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => {
    return {
        UnauthorizedError: UnauthorizedErrorMock,
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

afterEach(() => {
    vi.restoreAllMocks()
    connectMock.mockReset()
    listToolsMock.mockReset()
    closeMock.mockReset()
    createRuntimeMcpOAuthProviderMock.mockReset()
    streamableInstances.splice(0)
    stdioInstances.splice(0)
    delete process.env.MCP_TOKEN
    delete process.env.BASE_ENV
})

describe('mcp client pool', () => {
    test('connects HTTP server with oauth settings and request headers', async () => {
        const authProvider = { kind: 'oauth-provider' }
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(authProvider)
        connectMock.mockResolvedValue(undefined)
        listToolsMock.mockResolvedValue({
            tools: [{ name: 'search', description: 'Search docs', inputSchema: { type: 'object' } }],
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
        expect(connectMock).toHaveBeenCalledTimes(1)
        assert.strictEqual(streamableInstances.length, 1)
        const transport = streamableInstances[0]
        assert.strictEqual(transport?.url.toString(), 'https://example.com/mcp')
        expect(transport?.options.authProvider).toEqual(authProvider)
        expect(transport?.options.requestInit).toEqual({
            headers: {
                'X-Custom': 'value',
                Authorization: 'Bearer token-123',
            },
        })
        assert.strictEqual(connection.tools.length, 1)
        assert.strictEqual(connection.tools[0]?.name, 'remote_search')
    })

    test('reuses inflight connect promise for same server', async () => {
        let resolveConnect!: () => void
        const connectPromise = new Promise<void>((resolve) => {
            resolveConnect = resolve
        })
        connectMock.mockImplementation(() => connectPromise)
        listToolsMock.mockResolvedValue({ tools: [] })
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()
        const config = httpConfig()

        const first = pool.connect('remote', config)
        const second = pool.connect('remote')

        resolveConnect()
        const [left, right] = await Promise.all([first, second])

        expect(connectMock).toHaveBeenCalledTimes(1)
        assert.strictEqual(left, right)
    })

    test('includes login hint for unauthorized HTTP failures', async () => {
        connectMock.mockRejectedValue(new UnauthorizedErrorMock('unauthorized'))
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()

        await expect(pool.connect('remote', httpConfig())).rejects.toThrow('Run "memo mcp login remote".')
    })

    test('includes login hint for 403 streamable HTTP failures', async () => {
        connectMock.mockRejectedValue(new StreamableHTTPErrorMock('forbidden', 403))
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()

        await expect(pool.connect('remote', httpConfig())).rejects.toThrow('Run "memo mcp login remote".')
    })

    test('does not include login hint for non-auth failures', async () => {
        connectMock.mockRejectedValue(new Error('network timeout'))
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()

        await expect(pool.connect('remote', httpConfig())).rejects.toThrow(
            'Failed to connect via streamable_http (network timeout).',
        )
    })

    test('closes client when listing tools fails', async () => {
        connectMock.mockResolvedValue(undefined)
        listToolsMock.mockRejectedValue(new Error('list failed'))
        closeMock.mockResolvedValue(undefined)
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()

        await expect(pool.connect('remote', httpConfig())).rejects.toThrow('list failed')
        expect(closeMock).toHaveBeenCalledTimes(1)
    })

    test('connects stdio server with merged env and explicit stderr mode', async () => {
        connectMock.mockResolvedValue(undefined)
        listToolsMock.mockResolvedValue({ tools: [] })
        process.env.BASE_ENV = 'base'

        const pool = new McpClientPool()
        await pool.connect('local', {
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
        delete process.env.BASE_ENV
    })

    test('closeAll logs close failures and clears connected clients', async () => {
        connectMock.mockResolvedValue(undefined)
        listToolsMock.mockResolvedValue({ tools: [] })
        closeMock.mockRejectedValue(new Error('close failed'))
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const pool = new McpClientPool()
        await pool.connect('remote', httpConfig())
        assert.strictEqual(pool.size, 1)

        await pool.closeAll()

        assert.strictEqual(pool.size, 0)
        expect(consoleSpy).toHaveBeenCalled()
    })

    test('tracks known servers from configs and active connections', async () => {
        connectMock.mockResolvedValue(undefined)
        listToolsMock.mockResolvedValue({ tools: [] })
        createRuntimeMcpOAuthProviderMock.mockResolvedValue(null)

        const pool = new McpClientPool()
        pool.setServerConfigs({ configured: httpConfig() })
        assert.strictEqual(pool.hasServer('configured'), true)

        await pool.connect('connected', httpConfig({ url: 'https://example.com/other' }))
        const names = pool.getKnownServerNames()

        expect(names).toContain('configured')
        expect(names).toContain('connected')
    })
})
