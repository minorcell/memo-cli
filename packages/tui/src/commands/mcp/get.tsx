import React, { useEffect } from 'react'
import zod from 'zod'
import { option, argument } from 'pastel'
import { loadMemoConfig } from '@memo/core'
import { formatServer } from '../../features/mcp/mcpHelpers'

export const options = zod.object({
    json: zod
        .boolean()
        .optional()
        .default(false)
        .describe(option({ description: 'Output as JSON', alias: 'j' })),
})

export const args = zod.array(zod.string()).describe(argument({ name: 'name', description: 'Server name' }))

export default function McpGet({
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
            if (opts.json) {
                console.log(JSON.stringify(server, null, 2))
            } else {
                console.log(formatServer(name, server))
            }
            process.exit(0)
        }
        run()
    }, [])

    return null
}
