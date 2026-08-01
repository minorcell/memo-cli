import assert from 'node:assert'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, describe, test, vi } from 'vitest'
import { setActiveMcpCacheStore, setActiveMcpPool } from '@memo/core/tools/router/mcp/context'
import {
    __resetMcpResourceCacheForTests,
    listMcpResourceTemplatesTool,
    listMcpResourcesTool,
    readMcpResourceTool,
} from '@memo/core/tools/tools/mcp_resources'

function textPayload(result: { content?: Array<{ type: string; text?: string }> }) {
    const first = result.content?.find((item) => item.type === 'text')
    return first?.text ?? ''
}

afterEach(() => {
    setActiveMcpPool(null)
    setActiveMcpCacheStore(null)
    __resetMcpResourceCacheForTests()
    vi.useRealTimers()
})

describe('mcp resource tools', () => {
    test('returns error when MCP pool is missing', async () => {
        setActiveMcpPool(null)
        const result = await listMcpResourcesTool.execute({})
        assert.strictEqual(result.isError, true)
        assert.ok(textPayload(result).includes('not initialized'))
    })

    test('lists resources for a specific server with cursor', async () => {
        let capturedCursor: unknown = undefined
        let callCount = 0
        const connection = {
            name: 'alpha',
            client: {
                listResources: async (params?: unknown) => {
                    callCount += 1
                    capturedCursor = params
                    return {
                        resources: [{ uri: 'memo://a', name: 'A' }],
                        nextCursor: 'next-a',
                    }
                },
            },
        }

        const pool = {
            get: (name: string) => (name === 'alpha' ? connection : undefined),
            getAll: () => [connection],
        }
        setActiveMcpPool(pool as any)

        const first = await listMcpResourcesTool.execute({ server: 'alpha', cursor: 'c1' })
        const second = await listMcpResourcesTool.execute({ server: 'alpha', cursor: 'c1' })

        assert.ok(!first.isError)
        assert.deepStrictEqual(capturedCursor, { cursor: 'c1' })
        assert.strictEqual(callCount, 1)

        const parsed = JSON.parse(textPayload(first))
        assert.strictEqual(parsed.server, 'alpha')
        assert.strictEqual(parsed.nextCursor, 'next-a')
        assert.strictEqual(parsed.resources[0].uri, 'memo://a')
        assert.strictEqual(textPayload(first), textPayload(second))
    })

    test('expires list resource cache after TTL', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-02-13T00:00:00.000Z'))

        let callCount = 0
        const connection = {
            name: 'alpha',
            client: {
                listResources: async () => {
                    callCount += 1
                    return {
                        resources: [{ uri: 'memo://a', name: `A-${callCount}` }],
                    }
                },
            },
        }
        const pool = {
            get: (name: string) => (name === 'alpha' ? connection : undefined),
            getAll: () => [connection],
        }
        setActiveMcpPool(pool as any)

        const first = await listMcpResourcesTool.execute({ server: 'alpha' })
        const second = await listMcpResourcesTool.execute({ server: 'alpha' })
        assert.strictEqual(callCount, 1)
        assert.strictEqual(textPayload(first), textPayload(second))

        vi.advanceTimersByTime(15_001)
        const third = await listMcpResourcesTool.execute({ server: 'alpha' })
        assert.strictEqual(callCount, 2)
        assert.notStrictEqual(textPayload(first), textPayload(third))
    })

    test('deduplicates in-flight list requests with same cache key', async () => {
        let callCount = 0
        let resolveList: ((value: { resources: Array<{ uri: string; name: string }> }) => void) | null = null

        const connection = {
            name: 'alpha',
            client: {
                listResources: async () => {
                    callCount += 1
                    return await new Promise<{ resources: Array<{ uri: string; name: string }> }>((resolve) => {
                        resolveList = resolve
                    })
                },
            },
        }

        const pool = {
            get: (name: string) => (name === 'alpha' ? connection : undefined),
            getAll: () => [connection],
        }
        setActiveMcpPool(pool as any)

        const first = listMcpResourcesTool.execute({ server: 'alpha' })
        const second = listMcpResourcesTool.execute({ server: 'alpha' })
        for (let i = 0; i < 5 && callCount === 0; i += 1) {
            await Promise.resolve()
        }

        assert.strictEqual(callCount, 1)
        resolveList?.({ resources: [{ uri: 'memo://a', name: 'A' }] })

        const [firstResult, secondResult] = await Promise.all([first, second])
        assert.strictEqual(textPayload(firstResult), textPayload(secondResult))
    })

    test('aggregates resources from all servers in sorted order', async () => {
        const pool = {
            get: () => undefined,
            getAll: () => [
                {
                    name: 'zeta',
                    client: {
                        listResources: async () => ({
                            resources: [{ uri: 'memo://z', name: 'Z' }],
                        }),
                    },
                },
                {
                    name: 'alpha',
                    client: {
                        listResources: async () => ({
                            resources: [{ uri: 'memo://a', name: 'A' }],
                        }),
                    },
                },
            ],
        }
        setActiveMcpPool(pool as any)

        const result = await listMcpResourcesTool.execute({})
        const parsed = JSON.parse(textPayload(result))

        assert.strictEqual(parsed.resources[0].server, 'alpha')
        assert.strictEqual(parsed.resources[1].server, 'zeta')
    })

    test('aggregates resources with partial failures across servers', async () => {
        const pool = {
            get: () => undefined,
            getAll: () => [
                {
                    name: 'zeta',
                    client: {
                        listResources: async () => {
                            throw new Error('zeta unavailable')
                        },
                    },
                },
                {
                    name: 'alpha',
                    client: {
                        listResources: async () => ({
                            resources: [{ uri: 'memo://a', name: 'A' }],
                        }),
                    },
                },
            ],
        }
        setActiveMcpPool(pool as any)

        const result = await listMcpResourcesTool.execute({})
        assert.ok(!result.isError)

        const parsed = JSON.parse(textPayload(result))
        assert.strictEqual(parsed.resources.length, 1)
        assert.strictEqual(parsed.resources[0].server, 'alpha')
        assert.strictEqual(parsed.errors.length, 1)
        assert.strictEqual(parsed.errors[0].server, 'zeta')
    })

    test('rejects cursor without server in list tools', async () => {
        const pool = {
            get: () => undefined,
            getAll: () => [],
        }
        setActiveMcpPool(pool as any)

        const resourcesResult = await listMcpResourcesTool.execute({ cursor: 'x' })
        assert.strictEqual(resourcesResult.isError, true)

        const templatesResult = await listMcpResourceTemplatesTool.execute({ cursor: 'x' })
        assert.strictEqual(templatesResult.isError, true)
    })

    test('caches list resource templates for same key', async () => {
        let callCount = 0
        const connection = {
            name: 'alpha',
            client: {
                listResourceTemplates: async () => {
                    callCount += 1
                    return {
                        resourceTemplates: [{ uriTemplate: 'memo://{id}', name: 'tpl' }],
                    }
                },
            },
        }
        const pool = {
            get: (name: string) => (name === 'alpha' ? connection : undefined),
            getAll: () => [connection],
        }
        setActiveMcpPool(pool as any)

        const first = await listMcpResourceTemplatesTool.execute({ server: 'alpha' })
        const second = await listMcpResourceTemplatesTool.execute({ server: 'alpha' })

        assert.strictEqual(callCount, 1)
        assert.strictEqual(textPayload(first), textPayload(second))
    })

    test('reads resource by server + uri', async () => {
        let capturedUri: unknown
        let callCount = 0
        const connection = {
            name: 'alpha',
            client: {
                readResource: async (params: unknown) => {
                    callCount += 1
                    capturedUri = params
                    return {
                        contents: [{ uri: 'memo://a', text: 'payload' }],
                    }
                },
            },
        }
        const pool = {
            get: (name: string) => (name === 'alpha' ? connection : undefined),
            getAll: () => [connection],
        }
        setActiveMcpPool(pool as any)

        const first = await readMcpResourceTool.execute({ server: 'alpha', uri: 'memo://a' })
        const second = await readMcpResourceTool.execute({ server: 'alpha', uri: 'memo://a' })
        assert.ok(!first.isError)
        assert.strictEqual(callCount, 1)
        assert.deepStrictEqual(capturedUri, { uri: 'memo://a' })
        const parsed = JSON.parse(textPayload(first))
        assert.strictEqual(parsed.server, 'alpha')
        assert.strictEqual(parsed.contents[0].text, 'payload')
        assert.strictEqual(textPayload(first), textPayload(second))
    })

    test('returns not found error for missing server', async () => {
        const pool = {
            get: () => undefined,
            getAll: () => [],
        }
        setActiveMcpPool(pool as any)

        const result = await readMcpResourceTool.execute({ server: 'none', uri: 'memo://x' })
        assert.strictEqual(result.isError, true)
        assert.ok(textPayload(result).includes('MCP server not found'))
    })

    test('persists cache to memo home and warms next process', async () => {
        const originalMemoHome = process.env.MEMO_HOME
        const originalVitest = process.env.VITEST
        const originalNodeEnv = process.env.NODE_ENV
        const originalForceDiskCache = process.env.MEMO_FORCE_MCP_DISK_CACHE

        const memoHome = await mkdtemp(join(tmpdir(), 'memo-mcp-cache-'))
        process.env.MEMO_HOME = memoHome
        delete process.env.VITEST
        process.env.NODE_ENV = 'development'
        process.env.MEMO_FORCE_MCP_DISK_CACHE = '1'

        try {
            let callCount = 0
            const connection = {
                name: 'alpha',
                client: {
                    listResources: async () => {
                        callCount += 1
                        return {
                            resources: [{ uri: 'memo://a', name: 'A' }],
                        }
                    },
                },
            }
            const pool = {
                get: (name: string) => (name === 'alpha' ? connection : undefined),
                getAll: () => [connection],
            }
            setActiveMcpPool(pool as any)

            await listMcpResourcesTool.execute({ server: 'alpha' })
            assert.strictEqual(callCount, 1)

            await new Promise((resolve) => setTimeout(resolve, 220))
            const persistedPath = join(memoHome, 'cache', 'mcp.json')
            const raw = await readFile(persistedPath, 'utf8')
            const parsed = JSON.parse(raw) as {
                responses?: Record<string, unknown>
            }
            assert.ok(parsed.responses)
            assert.ok(Object.keys(parsed.responses ?? {}).some((k) => k.startsWith('list_resources:')))

            __resetMcpResourceCacheForTests()
            await listMcpResourcesTool.execute({ server: 'alpha' })
            assert.strictEqual(callCount, 1)
        } finally {
            if (originalMemoHome === undefined) {
                delete process.env.MEMO_HOME
            } else {
                process.env.MEMO_HOME = originalMemoHome
            }

            if (originalVitest === undefined) {
                delete process.env.VITEST
            } else {
                process.env.VITEST = originalVitest
            }

            if (originalNodeEnv === undefined) {
                delete process.env.NODE_ENV
            } else {
                process.env.NODE_ENV = originalNodeEnv
            }

            if (originalForceDiskCache === undefined) {
                delete process.env.MEMO_FORCE_MCP_DISK_CACHE
            } else {
                process.env.MEMO_FORCE_MCP_DISK_CACHE = originalForceDiskCache
            }

            __resetMcpResourceCacheForTests()
            await rm(memoHome, { recursive: true, force: true })
        }
    })
})
