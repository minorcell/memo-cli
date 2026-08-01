import assert from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    deleteMcpOAuthCredential,
    getMcpAuthStatus,
    getMcpOAuthCredential,
    setMcpOAuthCredential,
    supportsOAuthLogin,
} from './oauth'

const TEST_URL = 'https://example.com/mcp'

async function withTempMemoHome(run: (home: string) => Promise<void>) {
    const home = await mkdtemp(join(tmpdir(), 'memo-mcp-oauth-'))
    try {
        await run(home)
    } finally {
        await rm(home, { recursive: true, force: true })
    }
}

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('mcp oauth credential storage', () => {
    test('stores and removes credentials in file mode', async () => {
        await withTempMemoHome(async (home) => {
            const write = await setMcpOAuthCredential(
                TEST_URL,
                {
                    tokens: {
                        access_token: 'token-1',
                        token_type: 'Bearer',
                    },
                },
                {
                    memoHome: home,
                    storeMode: 'file',
                },
            )
            assert.strictEqual(write.backend, 'file')

            const loaded = await getMcpOAuthCredential(TEST_URL, {
                memoHome: home,
                storeMode: 'file',
            })
            assert.strictEqual(loaded.backend, 'file')
            assert.strictEqual(loaded.credential?.tokens?.access_token, 'token-1')

            const deleted = await deleteMcpOAuthCredential(TEST_URL, {
                memoHome: home,
                storeMode: 'file',
            })
            assert.strictEqual(deleted.removed, true)

            const after = await getMcpOAuthCredential(TEST_URL, {
                memoHome: home,
                storeMode: 'file',
            })
            assert.strictEqual(after.credential, undefined)
        })
    })

    test('uses MEMO_HOME when settings are omitted', async () => {
        await withTempMemoHome(async (home) => {
            const prevMemoHome = process.env.MEMO_HOME
            process.env.MEMO_HOME = home
            try {
                await setMcpOAuthCredential(TEST_URL, {
                    tokens: {
                        access_token: 'token-env-home',
                        token_type: 'Bearer',
                    },
                })

                const loaded = await getMcpOAuthCredential(TEST_URL)
                assert.strictEqual(loaded.backend, 'file')
                assert.strictEqual(loaded.credential?.tokens?.access_token, 'token-env-home')

                const deleted = await deleteMcpOAuthCredential(TEST_URL)
                assert.strictEqual(deleted.removed, true)
            } finally {
                if (prevMemoHome === undefined) {
                    delete process.env.MEMO_HOME
                } else {
                    process.env.MEMO_HOME = prevMemoHome
                }
            }
        })
    })

    test('keyring mode surfaces a clear error when unavailable', async () => {
        const expected = 'Keyring storage is not available. Set mcp_oauth_credentials_store_mode = "file".'

        await expect(
            getMcpOAuthCredential(TEST_URL, {
                storeMode: 'keyring',
            }),
        ).rejects.toThrow(expected)
        await expect(
            setMcpOAuthCredential(
                TEST_URL,
                {
                    tokens: {
                        access_token: 'token-keyring',
                        token_type: 'Bearer',
                    },
                },
                { storeMode: 'keyring' },
            ),
        ).rejects.toThrow(expected)
        await expect(
            deleteMcpOAuthCredential(TEST_URL, {
                storeMode: 'keyring',
            }),
        ).rejects.toThrow(expected)
    })
})

describe('mcp auth status', () => {
    test('returns unsupported for stdio config', async () => {
        const status = await getMcpAuthStatus(
            {
                command: 'node',
                args: ['server.js'],
            },
            {},
        )
        assert.strictEqual(status, 'unsupported')
    })

    test('returns bearer_token when bearer env var is configured', async () => {
        const status = await getMcpAuthStatus({
            type: 'streamable_http',
            url: TEST_URL,
            bearer_token_env_var: 'MCP_TOKEN',
        })
        assert.strictEqual(status, 'bearer_token')
    })

    test('returns oauth when stored token exists', async () => {
        await withTempMemoHome(async (home) => {
            await setMcpOAuthCredential(
                TEST_URL,
                {
                    tokens: {
                        access_token: 'token-2',
                        token_type: 'Bearer',
                    },
                },
                {
                    memoHome: home,
                    storeMode: 'file',
                },
            )

            const status = await getMcpAuthStatus(
                {
                    type: 'streamable_http',
                    url: TEST_URL,
                },
                {
                    memoHome: home,
                    storeMode: 'file',
                },
            )
            assert.strictEqual(status, 'oauth')
        })
    })

    test('returns not_logged_in when oauth metadata is discoverable', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                return new Response(
                    JSON.stringify({
                        authorization_endpoint: 'https://example.com/oauth/authorize',
                        token_endpoint: 'https://example.com/oauth/token',
                    }),
                    {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                )
            }),
        )

        const status = await getMcpAuthStatus({
            type: 'streamable_http',
            url: TEST_URL,
        })
        assert.strictEqual(status, 'not_logged_in')
        expect(fetch).toHaveBeenCalled()
    })

    test('returns unsupported when oauth metadata is not discoverable', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                return new Response('not found', { status: 404 })
            }),
        )

        const supported = await supportsOAuthLogin(TEST_URL)
        assert.strictEqual(supported, false)

        const status = await getMcpAuthStatus({
            type: 'streamable_http',
            url: TEST_URL,
        })
        assert.strictEqual(status, 'unsupported')
        expect(fetch).toHaveBeenCalled()
    })

    test('supportsOAuthLogin probes fallback discovery paths for nested URLs', async () => {
        const calls: string[] = []
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input) => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
                calls.push(url)
                if (url.includes('/v1/mcp/.well-known/oauth-authorization-server')) {
                    return new Response(
                        JSON.stringify({
                            authorization_endpoint: 'https://example.com/oauth/authorize',
                            token_endpoint: 'https://example.com/oauth/token',
                        }),
                        {
                            status: 200,
                            headers: { 'content-type': 'application/json' },
                        },
                    )
                }
                return new Response('not found', { status: 404 })
            }),
        )

        const supported = await supportsOAuthLogin('https://example.com/v1/mcp')
        assert.strictEqual(supported, true)
        expect(calls).toContain('https://example.com/.well-known/oauth-authorization-server/v1/mcp')
        expect(calls).toContain('https://example.com/v1/mcp/.well-known/oauth-authorization-server')
    })

    test('getMcpAuthStatus forwards configured HTTP headers during discovery', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_input, init) => {
                const headers = new Headers(init?.headers)
                assert.strictEqual(headers.get('X-Memo-Header'), 'header-value')
                assert.strictEqual(headers.get('MCP-Protocol-Version'), '2024-11-05')
                return new Response(
                    JSON.stringify({
                        authorization_endpoint: 'https://example.com/oauth/authorize',
                        token_endpoint: 'https://example.com/oauth/token',
                    }),
                    {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                )
            }),
        )

        const status = await getMcpAuthStatus({
            type: 'streamable_http',
            url: TEST_URL,
            http_headers: {
                'X-Memo-Header': 'header-value',
            },
        })
        assert.strictEqual(status, 'not_logged_in')
    })
})
