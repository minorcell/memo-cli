import React, { useEffect } from 'react'
import zod from 'zod'
import { option, argument } from 'pastel'
import { loadMemoConfig } from '@memo/core'
import { loginMcpServerOAuth } from '@memo/tools/router/mcp/oauth'
import { getErrorMessage, oauthSettingsFromLoaded } from '../../features/mcp/mcpHelpers'

export const options = zod.object({
    scopes: zod
        .string()
        .optional()
        .describe(
            option({
                description: 'Comma-separated OAuth scopes',
                valueDescription: 'scope1,scope2',
            }),
        ),
})

export const args = zod.array(zod.string()).describe(argument({ name: 'name', description: 'Server name' }))

export default function McpLogin({
    options: opts,
    args: positionals,
}: {
    options: zod.infer<typeof options>
    args: zod.infer<typeof args>
}) {
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
                console.error('OAuth login only applies to streamable HTTP servers.')
                process.exit(1)
            }

            const scopes = opts.scopes
                ? opts.scopes
                      .split(/[,\s]+/g)
                      .map((s) => s.trim())
                      .filter(Boolean)
                : undefined

            console.log(`Starting OAuth login for "${name}"...`)
            try {
                const result = await loginMcpServerOAuth({
                    serverName: name,
                    config: server,
                    scopes,
                    settings: oauthSettingsFromLoaded(loaded),
                    onAuthorizationUrl: (url) => {
                        console.log(`Open this URL to authorize:\n${url}`)
                    },
                    onBrowserOpenFailure: () => {
                        console.log('Browser launch failed. Open the URL above manually.')
                    },
                })
                console.log(`OAuth login completed for "${name}" (credentials stored in ${result.backend}).`)
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
