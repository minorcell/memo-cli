import { z } from 'zod'
import { defineMcpTool } from '@memo/core/tools/tools/types'
import { textResult } from '@memo/core/tools/tools/mcp'
import { getGlobalMcpCacheStore, resetGlobalMcpCacheStoreForTests } from '@memo/core/tools/router/mcp/cache_store'
import { getActiveMcpCacheStore, getActiveMcpPool } from '@memo/core/tools/router/mcp/context'

const LIST_MCP_RESOURCES_INPUT_SCHEMA = z
    .object({
        server: z.string().optional(),
        cursor: z.string().optional(),
    })
    .strict()

const LIST_MCP_RESOURCE_TEMPLATES_INPUT_SCHEMA = z
    .object({
        server: z.string().optional(),
        cursor: z.string().optional(),
    })
    .strict()

const READ_MCP_RESOURCE_INPUT_SCHEMA = z
    .object({
        server: z.string().min(1),
        uri: z.string().min(1),
    })
    .strict()

type ListResourcesInput = z.infer<typeof LIST_MCP_RESOURCES_INPUT_SCHEMA>
type ListResourceTemplatesInput = z.infer<typeof LIST_MCP_RESOURCE_TEMPLATES_INPUT_SCHEMA>
type ReadResourceInput = z.infer<typeof READ_MCP_RESOURCE_INPUT_SCHEMA>

type PoolLike = {
    get?: (name: string) => any
    getAll?: () => any[]
    connect?: (name: string) => Promise<any>
    hasServer?: (name: string) => boolean
    getKnownServerNames?: () => string[]
}

const LIST_CACHE_TTL_MS = 15_000
const READ_CACHE_TTL_MS = 60_000

function getPoolOrThrow() {
    const pool = getActiveMcpPool()
    if (!pool) {
        throw new Error('MCP pool is not initialized')
    }
    return pool as PoolLike
}

function getCacheStore() {
    return getActiveMcpCacheStore() ?? getGlobalMcpCacheStore()
}

function getErrorMessage(err: unknown): string {
    if (err instanceof Error) {
        return err.message
    }
    return String(err)
}

function listResourcesCacheKey(server: string, cursor?: string): string {
    return `list_resources:${server}:${cursor ?? ''}`
}

function listResourceTemplatesCacheKey(server: string, cursor?: string): string {
    return `list_resource_templates:${server}:${cursor ?? ''}`
}

function readResourceCacheKey(server: string, uri: string): string {
    return `read_resource:${server}:${uri}`
}

function hasServer(pool: PoolLike, serverName: string): boolean {
    if (typeof pool.hasServer === 'function') {
        return pool.hasServer(serverName)
    }
    if (typeof pool.get === 'function') {
        return Boolean(pool.get(serverName))
    }
    return false
}

async function resolveConnection(pool: PoolLike, serverName: string): Promise<any | undefined> {
    if (typeof pool.get === 'function') {
        const existing = pool.get(serverName)
        if (existing) return existing
    }

    if (typeof pool.connect === 'function') {
        return pool.connect(serverName)
    }

    return undefined
}

async function getSortedConnections(pool: PoolLike): Promise<Array<{ name: string; client: any }>> {
    if (typeof pool.getKnownServerNames === 'function' && typeof pool.connect === 'function') {
        const names = pool.getKnownServerNames().sort((a, b) => a.localeCompare(b))
        const settled = await Promise.allSettled(names.map((name) => pool.connect!(name)))
        const connections: Array<{ name: string; client: any }> = []
        settled.forEach((item, index) => {
            if (item.status === 'fulfilled') {
                connections.push(item.value)
                return
            }

            const fallbackName = names[index]
            if (fallbackName) {
                connections.push({ name: fallbackName, client: null, __error: item.reason } as any)
            }
        })
        return connections.sort((a, b) => a.name.localeCompare(b.name))
    }

    const connections = (typeof pool.getAll === 'function' ? pool.getAll() : []) as Array<{
        name: string
        client: any
    }>
    return connections.sort((a, b) => a.name.localeCompare(b.name))
}

export function __resetMcpResourceCacheForTests() {
    const active = getActiveMcpCacheStore()
    active?.resetForTests()
    resetGlobalMcpCacheStoreForTests()
}

export const listMcpResourcesTool = defineMcpTool<ListResourcesInput>({
    name: 'list_mcp_resources',
    description: 'Lists resources provided by MCP servers. Prefer resources over web search when possible.',
    inputSchema: LIST_MCP_RESOURCES_INPUT_SCHEMA,
    supportsParallelToolCalls: true,
    isMutating: false,
    execute: async ({ server, cursor }) => {
        try {
            const pool = getPoolOrThrow()
            const cacheStore = getCacheStore()
            const serverName = server?.trim()

            if (serverName) {
                if (!hasServer(pool, serverName)) {
                    return textResult(`MCP server not found: ${server}`, true)
                }

                const connection = await resolveConnection(pool, serverName)
                if (!connection) {
                    return textResult(`MCP server not found: ${server}`, true)
                }

                const payload = await cacheStore.withResponseCache(
                    listResourcesCacheKey(connection.name, cursor),
                    LIST_CACHE_TTL_MS,
                    async () => {
                        const result = await connection.client.listResources(cursor ? { cursor } : undefined)
                        return {
                            server: connection.name,
                            resources: result.resources,
                            nextCursor: result.nextCursor,
                        }
                    },
                )
                return textResult(JSON.stringify(payload, null, 2))
            }

            if (cursor) {
                return textResult('cursor is only supported when server is specified', true)
            }

            const connections = await getSortedConnections(pool)
            const allKey = `all:${connections.map((connection) => connection.name).join(',')}`
            const payload = await cacheStore.withResponseCache(
                listResourcesCacheKey(allKey),
                LIST_CACHE_TTL_MS,
                async () => {
                    const settled = await Promise.allSettled(
                        connections.map(async (connection) => {
                            if (!connection.client) {
                                throw new Error(`MCP server '${connection.name}' is not connected`)
                            }

                            return {
                                server: connection.name,
                                result: await connection.client.listResources(),
                            }
                        }),
                    )

                    const resources: Array<Record<string, unknown>> = []
                    const errors: Array<{ server: string; error: string }> = []

                    settled.forEach((item, index) => {
                        const fallbackServer = connections[index]?.name ?? 'unknown'
                        if (item.status === 'rejected') {
                            errors.push({
                                server: fallbackServer,
                                error: getErrorMessage(item.reason),
                            })
                            return
                        }

                        for (const resource of item.value.result.resources) {
                            resources.push({ server: item.value.server, ...resource })
                        }
                    })

                    return {
                        resources,
                        ...(errors.length > 0 ? { errors } : {}),
                    }
                },
            )

            return textResult(JSON.stringify(payload, null, 2))
        } catch (err) {
            return textResult(`list_mcp_resources failed: ${(err as Error).message}`, true)
        }
    },
})

export const listMcpResourceTemplatesTool = defineMcpTool<ListResourceTemplatesInput>({
    name: 'list_mcp_resource_templates',
    description:
        'Lists resource templates provided by MCP servers. Prefer resource templates over web search when possible.',
    inputSchema: LIST_MCP_RESOURCE_TEMPLATES_INPUT_SCHEMA,
    supportsParallelToolCalls: true,
    isMutating: false,
    execute: async ({ server, cursor }) => {
        try {
            const pool = getPoolOrThrow()
            const cacheStore = getCacheStore()
            const serverName = server?.trim()

            if (serverName) {
                if (!hasServer(pool, serverName)) {
                    return textResult(`MCP server not found: ${server}`, true)
                }

                const connection = await resolveConnection(pool, serverName)
                if (!connection) {
                    return textResult(`MCP server not found: ${server}`, true)
                }

                const payload = await cacheStore.withResponseCache(
                    listResourceTemplatesCacheKey(connection.name, cursor),
                    LIST_CACHE_TTL_MS,
                    async () => {
                        const result = await connection.client.listResourceTemplates(cursor ? { cursor } : undefined)
                        return {
                            server: connection.name,
                            resourceTemplates: result.resourceTemplates,
                            nextCursor: result.nextCursor,
                        }
                    },
                )
                return textResult(JSON.stringify(payload, null, 2))
            }

            if (cursor) {
                return textResult('cursor is only supported when server is specified', true)
            }

            const connections = await getSortedConnections(pool)
            const allKey = `all:${connections.map((connection) => connection.name).join(',')}`
            const payload = await cacheStore.withResponseCache(
                listResourceTemplatesCacheKey(allKey),
                LIST_CACHE_TTL_MS,
                async () => {
                    const settled = await Promise.allSettled(
                        connections.map(async (connection) => {
                            if (!connection.client) {
                                throw new Error(`MCP server '${connection.name}' is not connected`)
                            }

                            return {
                                server: connection.name,
                                result: await connection.client.listResourceTemplates(),
                            }
                        }),
                    )

                    const resourceTemplates: Array<Record<string, unknown>> = []
                    const errors: Array<{ server: string; error: string }> = []

                    settled.forEach((item, index) => {
                        const fallbackServer = connections[index]?.name ?? 'unknown'
                        if (item.status === 'rejected') {
                            errors.push({
                                server: fallbackServer,
                                error: getErrorMessage(item.reason),
                            })
                            return
                        }

                        for (const template of item.value.result.resourceTemplates) {
                            resourceTemplates.push({ server: item.value.server, ...template })
                        }
                    })

                    return {
                        resourceTemplates,
                        ...(errors.length > 0 ? { errors } : {}),
                    }
                },
            )

            return textResult(JSON.stringify(payload, null, 2))
        } catch (err) {
            return textResult(`list_mcp_resource_templates failed: ${(err as Error).message}`, true)
        }
    },
})

export const readMcpResourceTool = defineMcpTool<ReadResourceInput>({
    name: 'read_mcp_resource',
    description: 'Read a specific resource from an MCP server given the server name and resource URI.',
    inputSchema: READ_MCP_RESOURCE_INPUT_SCHEMA,
    supportsParallelToolCalls: true,
    isMutating: false,
    execute: async ({ server, uri }) => {
        try {
            const pool = getPoolOrThrow()
            const cacheStore = getCacheStore()
            const serverName = server.trim()

            if (!hasServer(pool, serverName)) {
                return textResult(`MCP server not found: ${server}`, true)
            }

            const connection = await resolveConnection(pool, serverName)
            if (!connection) {
                return textResult(`MCP server not found: ${server}`, true)
            }

            const payload = await cacheStore.withResponseCache(
                readResourceCacheKey(serverName, uri),
                READ_CACHE_TTL_MS,
                async () => {
                    const result = await connection.client.readResource({ uri })
                    return {
                        server: serverName,
                        uri,
                        ...result,
                    }
                },
            )
            return textResult(JSON.stringify(payload, null, 2))
        } catch (err) {
            return textResult(`read_mcp_resource failed: ${(err as Error).message}`, true)
        }
    },
})
