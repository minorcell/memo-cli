import React, { useEffect } from 'react'
import zod from 'zod'
import { option, argument } from 'pastel'
import { loadMemoConfig, writeMemoConfig, type MCPServerConfig } from '@memo/core'
import { parseEnvAssignment } from '../../features/mcp/mcpHelpers'

export const options = zod.object({
    url: zod
        .string()
        .optional()
        .describe(option({ description: 'URL for streamable HTTP server' })),
    bearerTokenEnvVar: zod
        .string()
        .optional()
        .describe(option({ description: 'Env var name for bearer token' })),
    env: zod
        .array(zod.string())
        .optional()
        .describe(
            option({
                description: 'Environment variable (KEY=VALUE)',
                valueDescription: 'KEY=VALUE',
            }),
        ),
})

export const args = zod.array(zod.string()).describe(argument({ name: 'name', description: 'Server name' }))

export default function McpAdd({
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

            const commandArgs = positionals.slice(1)

            if (opts.url) {
                if (commandArgs.length > 0) {
                    console.error('Use either --url or a stdio command, not both.')
                    process.exit(1)
                }
                if (opts.env && opts.env.length > 0) {
                    console.error('--env is only supported with stdio servers.')
                    process.exit(1)
                }
                try {
                    new URL(opts.url)
                } catch {
                    console.error('Invalid URL.')
                    process.exit(1)
                }
            } else if (commandArgs.length === 0) {
                console.error('Missing stdio command. Use --url for HTTP or provide a command.')
                process.exit(1)
            }

            if (opts.bearerTokenEnvVar && !opts.url) {
                console.error('--bearer-token-env-var is only supported with HTTP servers.')
                process.exit(1)
            }

            const loaded = await loadMemoConfig()
            const servers = { ...loaded.config.mcp_servers }
            if (servers[name]) {
                console.error(`MCP server "${name}" already exists.`)
                process.exit(1)
            }

            let entry: MCPServerConfig
            if (opts.url) {
                entry = {
                    type: 'streamable_http',
                    url: opts.url,
                    ...(opts.bearerTokenEnvVar ? { bearer_token_env_var: opts.bearerTokenEnvVar } : {}),
                }
            } else {
                const envMap: Record<string, string> = {}
                if (opts.env) {
                    for (const raw of opts.env) {
                        const parsed = parseEnvAssignment(raw)
                        if (!parsed) {
                            console.error(`Invalid --env format: "${raw}". Use KEY=VALUE.`)
                            process.exit(1)
                        }
                        envMap[parsed.key] = parsed.value
                    }
                }
                entry = {
                    command: commandArgs[0]!,
                    args: commandArgs.length > 1 ? commandArgs.slice(1) : undefined,
                    env: Object.keys(envMap).length > 0 ? envMap : undefined,
                }
            }

            servers[name] = entry
            await writeMemoConfig(loaded.configPath, { ...loaded.config, mcp_servers: servers })
            console.log(`Added MCP server "${name}".`)
            process.exit(0)
        }
        run()
    }, [])

    return null
}
