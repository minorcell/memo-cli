import assert from 'node:assert'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { McpToolRegistry } from './mcp'
import { ToolRouter, createToolRouter, type MCPServerConfig } from './index'

function serverConfig(): Record<string, MCPServerConfig> {
    return {
        remote: {
            type: 'streamable_http',
            url: 'https://example.com/mcp',
        },
    }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('tool router mcp oauth wiring', () => {
    test('loadMcpServers forwards oauth settings to mcp registry', async () => {
        const loadSpy = vi.spyOn(McpToolRegistry.prototype, 'loadServersWithOptions').mockResolvedValue(1)
        const router = new ToolRouter()
        const settings = { memoHome: '/tmp/memo', storeMode: 'file' as const, callbackPort: 4567 }

        const loaded = await router.loadMcpServers(serverConfig(), settings)

        assert.strictEqual(loaded, 1)
        expect(loadSpy).toHaveBeenCalledWith(serverConfig(), settings)
    })

    test('createToolRouter passes mcpOAuthSettings when loading servers', async () => {
        const loadSpy = vi.spyOn(McpToolRegistry.prototype, 'loadServersWithOptions').mockResolvedValue(1)
        const settings = {
            memoHome: '/tmp/memo-home',
            storeMode: 'auto' as const,
            callbackPort: 33333,
        }

        await createToolRouter({
            mcpServers: serverConfig(),
            mcpOAuthSettings: settings,
        })

        expect(loadSpy).toHaveBeenCalledWith(serverConfig(), settings)
    })

    test('createToolRouter skips load when no mcp servers are configured', async () => {
        const loadSpy = vi.spyOn(McpToolRegistry.prototype, 'loadServersWithOptions').mockResolvedValue(0)

        await createToolRouter({})

        expect(loadSpy).not.toHaveBeenCalled()
    })
})

describe('ToolRouter', () => {
    test('registerNativeTool adds tool to registry', () => {
        const router = new ToolRouter()
        router.registerNativeTool({
            name: 'test_tool',
            description: 'Test tool',
            source: 'native',
            inputSchema: { type: 'object' },
            execute: async () => ({ type: 'text', value: '' }),
        })

        expect(router.hasTool('test_tool')).toBe(true)
        expect(router.getTool('test_tool')).toBeDefined()
    })

    test('registerNativeTools registers multiple tools', () => {
        const router = new ToolRouter()
        router.registerNativeTools([
            {
                name: 'tool1',
                description: 'Tool 1',
                source: 'native',
                inputSchema: { type: 'object' },
                execute: async () => ({ type: 'text', value: '' }),
            },
            {
                name: 'tool2',
                description: 'Tool 2',
                source: 'native',
                inputSchema: { type: 'object' },
                execute: async () => ({ type: 'text', value: '' }),
            },
        ])

        expect(router.hasTool('tool1')).toBe(true)
        expect(router.hasTool('tool2')).toBe(true)
    })

    test('getAllTools returns combined native and mcp tools', () => {
        const router = new ToolRouter()
        router.registerNativeTool({
            name: 'native_tool',
            description: 'Native',
            source: 'native',
            inputSchema: { type: 'object' },
            execute: async () => ({ type: 'text', value: '' }),
        })

        const tools = router.getAllTools()
        expect(tools.length).toBeGreaterThan(0)
        expect(tools.some((t) => t.name === 'native_tool')).toBe(true)
    })

    test('toRegistry returns merged registry', () => {
        const router = new ToolRouter()
        router.registerNativeTool({
            name: 'test',
            description: 'Test',
            source: 'native',
            inputSchema: { type: 'object' },
            execute: async () => ({ type: 'text', value: '' }),
        })

        const registry = router.toRegistry()
        expect(registry.test).toBeDefined()
    })

    test('getToolCount returns counts', () => {
        const router = new ToolRouter()
        router.registerNativeTool({
            name: 'test',
            description: 'Test',
            source: 'native',
            inputSchema: { type: 'object' },
            execute: async () => ({ type: 'text', value: '' }),
        })

        const counts = router.getToolCount()
        expect(counts.native).toBeGreaterThan(0)
        expect(counts.total).toBe(counts.native + counts.mcp)
    })

    test('execute throws when tool not found', async () => {
        const router = new ToolRouter()
        await expect(router.execute('nonexistent', {})).rejects.toThrow("Tool 'nonexistent' not found")
    })

    test('execute runs tool successfully', async () => {
        const router = new ToolRouter()
        router.registerNativeTool({
            name: 'echo',
            description: 'Echo input',
            source: 'native',
            inputSchema: { type: 'object' },
            execute: async (input) => ({ type: 'text', value: JSON.stringify(input) }),
        })

        const result = await router.execute('echo', { test: true })
        expect(result).toEqual({ type: 'text', value: '{"test":true}' })
    })

    test('createToolRouter registers native tools', async () => {
        const router = await createToolRouter({
            nativeTools: [
                {
                    name: 'custom_tool',
                    description: 'Custom',
                    source: 'native',
                    inputSchema: { type: 'object' },
                    execute: async () => ({ type: 'text', value: '' }),
                },
            ],
        })

        expect(router.hasTool('custom_tool')).toBe(true)
    })
})
