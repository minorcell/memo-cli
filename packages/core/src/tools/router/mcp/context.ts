import type { McpClientPool } from './pool'
import type { McpCacheStore } from './cache_store'

let activePool: McpClientPool | null = null
let activeCacheStore: McpCacheStore | null = null

export function setActiveMcpPool(pool: McpClientPool | null) {
    activePool = pool
}

export function getActiveMcpPool(): McpClientPool | null {
    return activePool
}

export function setActiveMcpCacheStore(cacheStore: McpCacheStore | null) {
    activeCacheStore = cacheStore
}

export function getActiveMcpCacheStore(): McpCacheStore | null {
    return activeCacheStore
}
