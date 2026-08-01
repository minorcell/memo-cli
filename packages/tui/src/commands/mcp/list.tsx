import React, { useEffect } from 'react'
import zod from 'zod'
import { option } from 'pastel'
import { loadMemoConfig } from '@memo/core'
import { getMcpAuthStatus } from '@memo/core/tools/router/mcp/oauth'
import { formatServer, oauthSettingsFromLoaded } from '../../features/mcp/mcpHelpers'
import type { McpAuthStatus } from '@memo/core/tools/router/mcp/oauth'

export const options = zod.object({
    json: zod
        .boolean()
        .optional()
        .default(false)
        .describe(option({ description: 'Output as JSON', alias: 'j' })),
})

export default function McpList({ options: opts }: { options: zod.infer<typeof options> }) {
    useEffect(() => {
        async function run() {
            const loaded = await loadMemoConfig()
            const servers = loaded.config.mcp_servers ?? {}
            const names = Object.keys(servers)
            const settings = oauthSettingsFromLoaded(loaded)
            const authStatuses = new Map<string, McpAuthStatus>()

            await Promise.all(
                names.map(async (name) => {
                    const config = servers[name]
                    if (!config) return
                    try {
                        const status = await getMcpAuthStatus(config, settings)
                        authStatuses.set(name, status)
                    } catch {
                        authStatuses.set(name, 'unsupported')
                    }
                }),
            )

            if (opts.json) {
                const output: Record<string, unknown> = {}
                for (const name of names) {
                    const server = servers[name]
                    if (!server) continue
                    output[name] = {
                        ...server,
                        auth_status: authStatuses.get(name) ?? 'unsupported',
                    }
                }
                console.log(JSON.stringify(output, null, 2))
            } else if (names.length === 0) {
                console.log('No MCP servers configured. Add one with "memo mcp add".')
            } else {
                console.log(`MCP servers (${names.length}):`)
                for (const name of names) {
                    const config = servers[name]
                    if (!config) continue
                    console.log(formatServer(name, config, authStatuses.get(name)))
                }
            }
            process.exit(process.exitCode ?? 0)
        }
        run()
    }, [])

    return null
}
