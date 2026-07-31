import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import React, { useEffect, useState } from 'react'
import zod from 'zod'
import { option, argument } from 'pastel'
import {
    createAgentSession,
    loadMemoConfig,
    resolveContextWindowForProvider,
    writeMemoConfig,
    selectProvider,
    getSessionsDir,
    type AgentSessionDeps,
    type AgentSessionOptions,
    type MemoConfig,
} from '@memo/core'
import { App } from '../app/App'
import { parseHistoryLog } from '../features/session/historyParser'
import { loadSessionHistoryEntries } from '../features/session/sessionHistory'

export const options = zod.object({
    once: zod
        .boolean()
        .optional()
        .default(false)
        .describe(option({ description: 'Run once and exit', alias: 'o' })),
    prev: zod
        .boolean()
        .optional()
        .default(false)
        .describe(option({ description: 'Resume previous session', alias: 'p' })),
    dangerous: zod
        .boolean()
        .optional()
        .default(false)
        .describe(option({ description: 'Bypass all tool approvals', alias: 'd' })),
})

export const args = zod
    .array(zod.string())
    .default([])
    .describe(argument({ name: 'question', description: 'Your question' }))

async function ensureProviderConfig(mode: 'plain' | 'tui') {
    const loaded = await loadMemoConfig()
    if (!loaded.needsSetup) return loaded

    const defaultProvider = loaded.config.providers[0]
    const envCandidates = [defaultProvider?.env_api_key, 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY'].filter(
        Boolean,
    ) as string[]

    const hasEnvKey = envCandidates.some((key) => Boolean(process.env[key]))

    if (defaultProvider && hasEnvKey) {
        await writeMemoConfig(loaded.configPath, loaded.config)
        return { ...loaded, needsSetup: false }
    }

    if (mode === 'tui') {
        return loaded
    }

    const rl = createInterface({ input, output })
    const ask = async (prompt: string, fallback: string) => {
        const ans = (await rl.question(prompt)).trim()
        return ans || fallback
    }

    try {
        console.log('No provider config found. Please answer the prompts:')
        const name = await ask('Provider name [deepseek]: ', 'deepseek')
        const envKey = await ask('API key env var [DEEPSEEK_API_KEY]: ', 'DEEPSEEK_API_KEY')
        const model = await ask('Model name [deepseek-chat]: ', 'deepseek-chat')
        const baseUrl = await ask('Base URL [https://api.deepseek.com]: ', 'https://api.deepseek.com')

        const config: MemoConfig = {
            current_provider: name,
            providers: [{ name, env_api_key: envKey, model, base_url: baseUrl || undefined }],
        }
        await writeMemoConfig(loaded.configPath, config)
        console.log(`Config written to ${loaded.configPath}\n`)
        return { ...loaded, config, needsSetup: false }
    } finally {
        rl.close()
    }
}

async function loadPreviousSession(sessionsDir: string, cwd: string) {
    const entries = await loadSessionHistoryEntries({ sessionsDir, cwd, limit: 1 })
    const latest = entries[0]
    if (!latest) return null
    const raw = await readFile(latest.sessionFile, 'utf8')
    return parseHistoryLog(raw)
}

async function readStdin(): Promise<string> {
    return new Promise((resolve) => {
        let data = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (chunk) => {
            data += chunk
        })
        process.stdin.on('end', () => resolve(data.trim()))
        process.stdin.resume()
    })
}

export default function DefaultCommand({
    options: opts,
    args: positionals,
}: {
    options: zod.infer<typeof options>
    args: zod.infer<typeof args>
}) {
    const question = positionals.join(' ')
    const isTty = process.stdin.isTTY && process.stdout.isTTY
    const isPlain = opts.once || !isTty

    if (isPlain) {
        return <PlainMode opts={opts} question={question} />
    }
    return <TuiMode opts={opts} />
}

function PlainMode({ opts, question: initialQuestion }: { opts: zod.infer<typeof options>; question: string }) {
    useEffect(() => {
        async function run() {
            let question = initialQuestion
            if (!question && !process.stdin.isTTY) {
                question = await readStdin()
            }
            if (!question) {
                console.error('No input provided. Pass a question or use stdin.')
                process.exit(1)
            }

            const loaded = await ensureProviderConfig('plain')
            const provider = selectProvider(loaded.config)
            const contextWindow = resolveContextWindowForProvider(loaded.config, provider)
            const sessionId = randomUUID()
            const sessionOptions: AgentSessionOptions = {
                sessionId,
                mode: 'interactive',
                contextWindow,
                autoCompactThresholdPercent: loaded.config.auto_compact_threshold_percent,
                activeMcpServers: loaded.config.active_mcp_servers,
                dangerous: opts.dangerous,
            }
            const sessionsDir = getSessionsDir(loaded, sessionOptions)
            const prevSession = opts.prev ? await loadPreviousSession(sessionsDir, process.cwd()) : null

            if (opts.prev && !prevSession) {
                console.error('No previous session found for current directory.')
                process.exit(1)
            }

            if (opts.dangerous) {
                console.log('⚠️  DANGEROUS MODE: All tool approvals are bypassed!')
            }

            const deps: AgentSessionDeps = {
                requestApproval: opts.dangerous
                    ? undefined
                    : (request) => {
                          console.log(`\n[approval required] ${request.toolName}: ${request.reason}`)
                          console.log(`[approval] Run with --dangerous to bypass approval`)
                          return Promise.resolve('deny')
                      },
                hooks: {
                    onAction: ({ action }) => {
                        console.log(`\n[tool] ${action.tool}`)
                        if (action.input !== undefined) console.log(`[input] ${JSON.stringify(action.input)}`)
                    },
                    onObservation: () => {},
                },
            }

            const session = await createAgentSession(deps, sessionOptions)
            if (prevSession) {
                const sysMsg = session.history[0]
                if (sysMsg && prevSession.messages.length) {
                    session.history.splice(0, session.history.length, sysMsg, ...prevSession.messages)
                }
                console.log('[session] Continued from previous session context.')
            }

            try {
                console.log(`User: ${question}\n`)
                const turnResult = await session.runTurn(question)
                console.log(`\n${turnResult.finalText}`)
                console.log(
                    `\n[tokens] prompt=${turnResult.tokenUsage.inputTokens} completion=${turnResult.tokenUsage.outputTokens} total=${turnResult.tokenUsage.totalTokens}`,
                )
                console.log(`\nprovider=${provider.name} model=${provider.model}`)
            } catch (err) {
                console.error(`Run failed: ${(err as Error).message}`)
            } finally {
                await session.close()
            }
            process.exit(process.exitCode ?? 0)
        }
        run()
    }, [])

    return null
}

function TuiMode({ opts }: { opts: zod.infer<typeof options> }) {
    const [appProps, setAppProps] = useState<React.ComponentProps<typeof App> | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        async function init() {
            const loaded = await ensureProviderConfig('tui')
            const provider = selectProvider(loaded.config)
            const contextWindow = resolveContextWindowForProvider(loaded.config, provider)
            const sessionId = randomUUID()
            const sessionOptions: AgentSessionOptions = {
                sessionId,
                mode: 'interactive',
                contextWindow,
                autoCompactThresholdPercent: loaded.config.auto_compact_threshold_percent,
                activeMcpServers: loaded.config.active_mcp_servers,
                dangerous: opts.dangerous,
            }
            const sessionsDir = getSessionsDir(loaded, sessionOptions)
            const prevSession = opts.prev ? await loadPreviousSession(sessionsDir, process.cwd()) : null

            if (opts.prev && !prevSession) {
                setError('No previous session found for current directory.')
                return
            }

            setAppProps({
                sessionOptions,
                providerName: provider.name,
                model: provider.model,
                configPath: loaded.configPath,
                mcpServers: loaded.config.mcp_servers ?? {},
                cwd: process.cwd(),
                sessionsDir,
                providers: loaded.config.providers,
                modelProfiles: loaded.config.model_profiles,
                dangerous: opts.dangerous,
                needsSetup: loaded.needsSetup,
                initialHistory: prevSession ?? undefined,
            })
        }
        init()
    }, [])

    if (error) {
        return null
    }
    if (!appProps) {
        return null
    }
    return <App {...appProps} />
}
