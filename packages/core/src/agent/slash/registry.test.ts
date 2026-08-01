import assert from 'node:assert'
import { describe, test } from 'vitest'
import { resolveSlashCommand } from './registry'
import { TOOL_PERMISSION_MODES, type SlashContext } from './types'

function makeContext(overrides: Partial<SlashContext> = {}): SlashContext {
    return {
        configPath: '/tmp/.memo/config.toml',
        providerName: 'openai',
        model: 'gpt-4.1-mini',
        mcpServers: {},
        providers: [
            {
                name: 'openai',
                env_api_key: 'OPENAI_API_KEY',
                model: 'gpt-4.1-mini',
                base_url: 'https://api.openai.com/v1',
            },
            {
                name: 'deepseek',
                env_api_key: 'DEEPSEEK_API_KEY',
                model: 'deepseek-chat',
                base_url: 'https://api.deepseek.com',
            },
        ],
        toolPermissionMode: TOOL_PERMISSION_MODES.ONCE,
        ...overrides,
    }
}

describe('slash registry', () => {
    test('returns help/exit/new/compact/init command kinds', () => {
        const ctx = makeContext()
        const help = resolveSlashCommand('/help', ctx)
        assert.strictEqual(help.kind, 'message')
        if (help.kind === 'message') {
            assert.ok(help.content.includes('Available commands:'))
            assert.ok(help.content.includes('/tools'))
        }

        assert.deepStrictEqual(resolveSlashCommand('/exit', ctx), { kind: 'exit' })
        assert.deepStrictEqual(resolveSlashCommand('/new', ctx), { kind: 'new' })
        assert.deepStrictEqual(resolveSlashCommand('/compact', ctx), { kind: 'compact' })
        assert.deepStrictEqual(resolveSlashCommand('/init', ctx), { kind: 'init_agents_md' })
    })

    test('parses review command from number/hash/url and validates usage', () => {
        const ctx = makeContext()
        assert.deepStrictEqual(resolveSlashCommand('/review 123', ctx), {
            kind: 'review_pr',
            prNumber: 123,
        })
        assert.deepStrictEqual(resolveSlashCommand('/review #88', ctx), {
            kind: 'review_pr',
            prNumber: 88,
        })
        assert.deepStrictEqual(resolveSlashCommand('/review https://github.com/a/b/pull/77', ctx), {
            kind: 'review_pr',
            prNumber: 77,
        })

        const invalid = resolveSlashCommand('/review abc', ctx)
        assert.strictEqual(invalid.kind, 'message')
        if (invalid.kind === 'message') {
            assert.ok(invalid.content.includes('Usage: /review'))
        }
    })

    test('handles models command for empty, switch, and not-found paths', () => {
        const noProviders = resolveSlashCommand('/models', makeContext({ providers: [] }))
        assert.strictEqual(noProviders.kind, 'message')
        if (noProviders.kind === 'message') {
            assert.ok(noProviders.content.includes('No providers configured'))
        }

        const switchByProvider = resolveSlashCommand('/models deepseek', makeContext())
        assert.strictEqual(switchByProvider.kind, 'switch_model')
        if (switchByProvider.kind === 'switch_model') {
            assert.strictEqual(switchByProvider.provider.name, 'deepseek')
        }

        const switchByModel = resolveSlashCommand('/models gpt-4.1-mini', makeContext())
        assert.strictEqual(switchByModel.kind, 'switch_model')

        const notFound = resolveSlashCommand('/models unknown-provider', makeContext())
        assert.strictEqual(notFound.kind, 'message')
        if (notFound.kind === 'message') {
            assert.ok(notFound.content.includes('Not found: unknown-provider'))
            assert.ok(notFound.content.includes('(current)'))
        }
    })

    test('handles tools mode display, alias parsing, unsupported and already-selected', () => {
        const ctx = makeContext({ toolPermissionMode: TOOL_PERMISSION_MODES.ONCE })

        const status = resolveSlashCommand('/tools', ctx)
        assert.strictEqual(status.kind, 'message')
        if (status.kind === 'message') {
            assert.ok(status.content.includes('Current: once'))
            assert.ok(status.content.includes('Modes: none, once, full'))
        }

        const aliasFull = resolveSlashCommand('/tools dangerous', ctx)
        assert.deepStrictEqual(aliasFull, {
            kind: 'set_tool_permission',
            mode: TOOL_PERMISSION_MODES.FULL,
        })

        const unsupported = resolveSlashCommand('/tools invalid', ctx)
        assert.strictEqual(unsupported.kind, 'message')
        if (unsupported.kind === 'message') {
            assert.ok(unsupported.content.includes('Unsupported mode'))
        }

        const already = resolveSlashCommand('/tools ask', makeContext({ toolPermissionMode: 'once' }))
        assert.strictEqual(already.kind, 'message')
        if (already.kind === 'message') {
            assert.ok(already.content.includes('Already using once'))
        }
    })

    test('lists MCP servers for stdio and streamable_http and handles empty case', () => {
        const empty = resolveSlashCommand('/mcp', makeContext({ mcpServers: {} }))
        assert.strictEqual(empty.kind, 'message')
        if (empty.kind === 'message') {
            assert.ok(empty.content.includes('No MCP servers configured'))
        }

        const withServers = resolveSlashCommand(
            '/mcp',
            makeContext({
                mcpServers: {
                    remote: {
                        type: 'streamable_http',
                        url: 'https://example.com/mcp',
                        bearer_token_env_var: 'MCP_TOKEN',
                    },
                    local: {
                        type: 'stdio',
                        command: 'node',
                        args: ['server.js', '--debug'],
                    },
                },
            }),
        )

        assert.strictEqual(withServers.kind, 'message')
        if (withServers.kind === 'message') {
            assert.ok(withServers.content.includes('Total: 2'))
            assert.ok(withServers.content.includes('url: https://example.com/mcp'))
            assert.ok(withServers.content.includes('bearer: MCP_TOKEN'))
            assert.ok(withServers.content.includes('command: node'))
            assert.ok(withServers.content.includes('args: server.js --debug'))
        }
    })

    test('resume and unknown command branches', () => {
        const ctx = makeContext()
        const resume = resolveSlashCommand('/resume', ctx)
        assert.strictEqual(resume.kind, 'message')
        if (resume.kind === 'message') {
            assert.ok(resume.content.includes('Type "resume"'))
        }

        const unknown = resolveSlashCommand('/unknown', ctx)
        assert.strictEqual(unknown.kind, 'message')
        if (unknown.kind === 'message') {
            assert.ok(unknown.content.includes('Unknown command: /unknown'))
            assert.ok(unknown.content.includes('/help'))
        }
    })
})
