import assert from 'node:assert'
import { afterEach, describe, test, vi } from 'vitest'
import type { MCPServerConfig } from '../types'
import { getGlobalMcpCacheStore, resetGlobalMcpCacheStoreForTests } from './cache_store'
import { McpToolRegistry } from './index'

const BASE_TIME = new Date('2026-02-13T12:00:00.000Z').getTime()

function createConfig(): MCPServerConfig {
    return {
        type: 'streamable_http',
        url: 'https://example.com/mcp',
    }
}

function createConnection(serverName: string, toolName: string) {
    return {
        name: serverName,
        client: {
            callTool: async () => ({ content: [] }),
        },
        transport: {} as any,
        tools: [
            {
                name: `${serverName}_${toolName}`,
                description: `Tool from ${serverName}: ${toolName}`,
                source: 'mcp' as const,
                serverName,
                originalName: toolName,
                inputSchema: {},
                execute: async () => ({ content: [] }),
            },
        ],
    }
}

afterEach(() => {
    resetGlobalMcpCacheStoreForTests()
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('mcp tool registry cache bootstrap', () => {
    test('loads fresh cached tools without synchronous connect', async () => {
        const store = getGlobalMcpCacheStore()
        const config = createConfig()
        await store.setServerTools('alpha', config, [
            {
                originalName: 'cached_tool',
                description: 'cached tool',
                inputSchema: { type: 'object' },
            },
        ])

        const registry = new McpToolRegistry()
        const connectSpy = vi.spyOn(registry.getPool(), 'connect')
        const loaded = await registry.loadServers({ alpha: config })

        assert.strictEqual(loaded, 1)
        assert.strictEqual(connectSpy.mock.calls.length, 0)
        assert.ok(registry.has('alpha_cached_tool'))

        await registry.dispose()
    })

    test('uses stale cache immediately and refreshes in background', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(BASE_TIME)

        const store = getGlobalMcpCacheStore()
        const config = createConfig()
        await store.setServerTools('alpha', config, [
            {
                originalName: 'stale_tool',
                description: 'stale tool',
                inputSchema: { type: 'object' },
            },
        ])

        vi.setSystemTime(BASE_TIME + 11 * 60 * 1000)

        const registry = new McpToolRegistry()
        const connectSpy = vi
            .spyOn(registry.getPool(), 'connect')
            .mockImplementation(
                async () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve(createConnection('alpha', 'fresh_tool') as any), 0),
                    ),
            )

        const loaded = await registry.loadServers({ alpha: config })
        assert.strictEqual(loaded, 1)
        assert.ok(registry.has('alpha_stale_tool'))

        await vi.runAllTimersAsync()

        assert.ok(connectSpy.mock.calls.length >= 1)
        assert.ok(registry.has('alpha_fresh_tool'))
        assert.ok(!registry.has('alpha_stale_tool'))

        await registry.dispose()
    })
})
