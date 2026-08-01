import assert from 'node:assert'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test, vi } from 'vitest'
import { McpCacheStore } from './cache_store'
import type { MCPServerConfig } from '../types'

const BASE_TIME = new Date('2026-02-13T12:00:00.000Z').getTime()

async function withTempMemoHome(run: (memoHome: string) => Promise<void>): Promise<void> {
    const originalMemoHome = process.env.MEMO_HOME
    const originalVitest = process.env.VITEST
    const originalNodeEnv = process.env.NODE_ENV
    const originalForceDiskCache = process.env.MEMO_FORCE_MCP_DISK_CACHE
    const memoHome = await mkdtemp(join(tmpdir(), 'memo-cache-store-'))

    process.env.MEMO_HOME = memoHome
    delete process.env.VITEST
    process.env.NODE_ENV = 'development'
    process.env.MEMO_FORCE_MCP_DISK_CACHE = '1'

    try {
        await run(memoHome)
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

        await rm(memoHome, { recursive: true, force: true })
    }
}

afterEach(() => {
    vi.useRealTimers()
})

describe('mcp cache store', () => {
    test('loads cached tools on next store instance and marks stale by age', async () => {
        await withTempMemoHome(async (memoHome) => {
            const config: MCPServerConfig = {
                type: 'streamable_http',
                url: 'https://example.com/mcp',
            }
            vi.useFakeTimers()
            vi.setSystemTime(BASE_TIME)

            const store = new McpCacheStore()
            await store.setServerTools('alpha', config, [
                {
                    originalName: 'read_note',
                    description: 'read note',
                    inputSchema: { type: 'object' },
                },
            ])
            await store.flushForTests()

            const cachePath = join(memoHome, 'cache', 'mcp.json')
            const raw = await readFile(cachePath, 'utf8')
            const parsed = JSON.parse(raw) as {
                toolsByServer?: Record<string, unknown>
            }
            assert.ok(parsed.toolsByServer?.alpha)

            vi.setSystemTime(BASE_TIME + 2 * 60 * 1000)
            const nextFreshStore = new McpCacheStore()
            const fresh = await nextFreshStore.getServerTools('alpha', config)
            assert.ok(fresh)
            assert.strictEqual(fresh?.stale, false)
            assert.strictEqual(fresh?.tools.length, 1)

            vi.setSystemTime(BASE_TIME + 11 * 60 * 1000)
            const nextStaleStore = new McpCacheStore()
            const stale = await nextStaleStore.getServerTools('alpha', config)
            assert.ok(stale)
            assert.strictEqual(stale?.stale, true)

            vi.setSystemTime(BASE_TIME + 25 * 60 * 60 * 1000)
            const nextExpiredStore = new McpCacheStore()
            const expired = await nextExpiredStore.getServerTools('alpha', config)
            assert.strictEqual(expired, null)
        })
    })

    test('persists response cache and hydrates next store instance', async () => {
        await withTempMemoHome(async () => {
            vi.useFakeTimers()
            vi.setSystemTime(BASE_TIME)

            const store = new McpCacheStore()
            let loadCount = 0
            const first = await store.withResponseCache('k1', 30_000, async () => {
                loadCount += 1
                return { value: 1 }
            })
            assert.deepStrictEqual(first, { value: 1 })
            assert.strictEqual(loadCount, 1)
            await store.flushForTests()

            const nextStore = new McpCacheStore()
            const second = await nextStore.withResponseCache('k1', 30_000, async () => {
                loadCount += 1
                return { value: 2 }
            })
            assert.deepStrictEqual(second, { value: 1 })
            assert.strictEqual(loadCount, 1)
        })
    })
})
