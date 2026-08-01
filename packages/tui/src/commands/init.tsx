import React, { useEffect } from 'react'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAgentSession, type AgentSessionDeps } from '@memo/core'
import { loadTaskPrompt } from '../shared/lib/taskPrompt'
import { ensureProviderConfig, buildRunContext } from '../shared/lib/runContext'
import { isAgentsMdWrite } from '../shared/lib/initApproval'

const AGENTS_FILE = 'AGENTS.md'

export default function InitCommand() {
    useEffect(() => {
        async function run() {
            const cwd = process.cwd()
            const agentsPath = resolve(cwd, AGENTS_FILE)

            // Guard: idempotent like `git init` — an existing AGENTS.md is never touched.
            if (existsSync(agentsPath)) {
                console.log(
                    `AGENTS.md already exists at ${agentsPath}. Skipping init.\nDelete it and run "memo init" again to regenerate.`,
                )
                process.exit(0)
            }

            const loaded = await ensureProviderConfig('plain')
            const { provider, sessionOptions } = await buildRunContext(loaded, false)

            const prompt = await loadTaskPrompt('init_agents')

            const deps: AgentSessionDeps = {
                // Whitelist: the model may only write <cwd>/AGENTS.md, nothing else.
                requestApproval: (request) =>
                    isAgentsMdWrite(request.toolName, request.params, cwd) ? 'once' : 'deny',
                hooks: {
                    onAction: ({ action }) => {
                        console.log(`\n[tool] ${action.tool}`)
                    },
                    onObservation: () => {},
                },
            }

            const session = await createAgentSession(deps, sessionOptions)
            try {
                console.log(`Generating ${AGENTS_FILE} (provider=${provider.name} model=${provider.model})\n`)
                const turnResult = await session.runTurn(prompt)
                if (turnResult.finalText) console.log(`\n${turnResult.finalText}`)
                console.log(
                    `\n[tokens] prompt=${turnResult.tokenUsage.inputTokens} completion=${turnResult.tokenUsage.outputTokens} total=${turnResult.tokenUsage.totalTokens}`,
                )
                console.log(`\nprovider=${provider.name} model=${provider.model}`)
                if (existsSync(agentsPath)) {
                    console.log(`\nCreated ${agentsPath}`)
                }
            } catch (err) {
                console.error(`Init failed: ${(err as Error).message}`)
                process.exitCode = 1
            } finally {
                await session.close()
            }
            process.exit(process.exitCode ?? 0)
        }
        run()
    }, [])

    return null
}
