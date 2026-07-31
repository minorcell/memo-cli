import React, { useEffect } from 'react'
import zod from 'zod'
import { argument } from 'pastel'
import { loadMemoConfig, writeMemoConfig } from '@memo/core'

export const args = zod.array(zod.string()).describe(argument({ name: 'name', description: 'Server name' }))

export default function McpRemove({ args: positionals }: { args: zod.infer<typeof args> }) {
    useEffect(() => {
        async function run() {
            const name = positionals[0]
            if (!name) {
                console.error('Missing server name.')
                process.exit(1)
            }
            const loaded = await loadMemoConfig()
            const servers = { ...loaded.config.mcp_servers }
            if (!servers[name]) {
                console.error(`Unknown MCP server "${name}".`)
                process.exit(1)
            }
            delete servers[name]
            await writeMemoConfig(loaded.configPath, { ...loaded.config, mcp_servers: servers })
            console.log(`Removed MCP server "${name}".`)
            process.exit(0)
        }
        run()
    }, [])

    return null
}
