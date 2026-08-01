import React, { useEffect } from 'react'
import zod from 'zod'
import { argument } from 'pastel'
import { loadMemoConfig } from '@memo/core'
import { logoutMcpServerOAuth } from '@memo/core'
import { getErrorMessage, oauthSettingsFromLoaded } from '../../features/mcp/mcpHelpers'

export const args = zod.array(zod.string()).describe(argument({ name: 'name', description: 'Server name' }))

export default function McpLogout({ args: positionals }: { args: zod.infer<typeof args> }) {
    useEffect(() => {
        async function run() {
            const name = positionals[0]
            if (!name) {
                console.error('Missing server name.')
                process.exit(1)
            }
            const loaded = await loadMemoConfig()
            const server = loaded.config.mcp_servers?.[name]
            if (!server) {
                console.error(`Unknown MCP server "${name}".`)
                process.exit(1)
            }
            if (!('url' in server)) {
                console.error('OAuth logout only applies to streamable HTTP servers.')
                process.exit(1)
            }

            try {
                const result = await logoutMcpServerOAuth({
                    config: server,
                    settings: oauthSettingsFromLoaded(loaded),
                })
                if (result.removed) {
                    console.log(`Removed OAuth credentials for "${name}".`)
                } else {
                    console.log(`No OAuth credentials stored for "${name}".`)
                }
                process.exit(0)
            } catch (error) {
                console.error(getErrorMessage(error))
                process.exit(1)
            }
        }
        run()
    }, [])

    return null
}
