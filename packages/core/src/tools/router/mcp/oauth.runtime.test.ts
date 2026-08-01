import assert from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const { authMock, spawnMock } = vi.hoisted(() => {
    return {
        authMock: vi.fn(),
        spawnMock: vi.fn(),
    }
})

vi.mock('@modelcontextprotocol/sdk/client/auth.js', async () => {
    const actual = await vi.importActual('@modelcontextprotocol/sdk/client/auth.js')
    return {
        ...(actual as object),
        auth: authMock,
    }
})

vi.mock('node:child_process', async () => {
    const actual = await vi.importActual('node:child_process')
    return {
        ...(actual as object),
        spawn: spawnMock,
    }
})

import {
    createRuntimeMcpOAuthProvider,
    getMcpOAuthCredential,
    loginMcpServerOAuth,
    openExternalUrl,
    setMcpOAuthCredential,
} from './oauth'

const TEST_URL = 'https://example.com/mcp'

function spawnChild({
    error,
}: {
    error?: Error
} = {}) {
    const child = {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (error && event === 'error') {
                handler(error)
            }
            if (!error && event === 'spawn') {
                handler()
            }
            return child
        }),
        off: vi.fn(() => child),
        unref: vi.fn(),
    }
    return child
}

async function withTempMemoHome(run: (home: string) => Promise<void>) {
    const home = await mkdtemp(join(tmpdir(), 'memo-mcp-oauth-runtime-'))
    try {
        await run(home)
    } finally {
        await rm(home, { recursive: true, force: true })
    }
}

function installDiscoveryFetch() {
    const realFetch = global.fetch
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown, init?: RequestInit) => {
            const url =
                typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : String((input as Request).url)

            if (url.includes('/.well-known/oauth-authorization-server')) {
                return new Response(
                    JSON.stringify({
                        authorization_endpoint: 'https://auth.example.com/authorize',
                        token_endpoint: 'https://auth.example.com/token',
                    }),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                )
            }

            return realFetch(input as RequestInfo | URL, init)
        }),
    )
}

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    authMock.mockReset()
    spawnMock.mockReset()
})

describe('oauth runtime helpers', () => {
    test('openExternalUrl resolves on successful spawn', async () => {
        const child = spawnChild()
        spawnMock.mockReturnValue(child)

        await openExternalUrl('https://example.com/oauth/authorize')

        expect(spawnMock).toHaveBeenCalled()
        expect(child.unref).toHaveBeenCalled()
    })

    test('openExternalUrl rejects when spawn reports error', async () => {
        spawnMock.mockReturnValue(spawnChild({ error: new Error('spawn failed') }))

        await expect(openExternalUrl('https://example.com/oauth/authorize')).rejects.toThrow('spawn failed')
    })

    test('createRuntimeMcpOAuthProvider returns null when no stored token exists', async () => {
        await withTempMemoHome(async (home) => {
            const provider = await createRuntimeMcpOAuthProvider({
                serverName: 'remote',
                config: { type: 'streamable_http', url: TEST_URL },
                settings: { memoHome: home, storeMode: 'file' },
            })
            assert.strictEqual(provider, null)
        })
    })

    test('createRuntimeMcpOAuthProvider validates callback port', async () => {
        await withTempMemoHome(async (home) => {
            await setMcpOAuthCredential(
                TEST_URL,
                {
                    tokens: {
                        access_token: 'seed-token',
                        token_type: 'Bearer',
                    },
                },
                { memoHome: home, storeMode: 'file' },
            )

            await expect(
                createRuntimeMcpOAuthProvider({
                    serverName: 'remote',
                    config: { type: 'streamable_http', url: TEST_URL },
                    settings: { memoHome: home, storeMode: 'file', callbackPort: 70000 },
                }),
            ).rejects.toThrow('Invalid MCP OAuth callback port')
        })
    })

    test('runtime provider supports token lifecycle operations', async () => {
        await withTempMemoHome(async (home) => {
            const settings = { memoHome: home, storeMode: 'file' as const, callbackPort: 40123 }
            await setMcpOAuthCredential(
                TEST_URL,
                {
                    tokens: {
                        access_token: 'seed-token',
                        token_type: 'Bearer',
                    },
                },
                settings,
            )

            const provider = await createRuntimeMcpOAuthProvider({
                serverName: 'remote',
                config: { type: 'streamable_http', url: TEST_URL },
                settings,
            })
            assert.ok(provider)
            const runtime = provider as any

            const initialTokens = await runtime.tokens()
            assert.strictEqual(initialTokens?.access_token, 'seed-token')

            await runtime.saveClientInformation({
                client_id: 'memo-client',
            })
            await runtime.saveTokens({
                access_token: 'updated-token',
                token_type: 'Bearer',
            })
            runtime.saveCodeVerifier('code-verifier')
            assert.strictEqual(runtime.codeVerifier(), 'code-verifier')

            await expect(
                runtime.redirectToAuthorization(new URL('https://auth.example.com/authorize')),
            ).rejects.toThrow('Run: memo mcp login remote')

            await runtime.invalidateCredentials('tokens')
            const afterTokenClear = await getMcpOAuthCredential(TEST_URL, settings)
            assert.strictEqual(afterTokenClear.credential?.tokens, undefined)

            await runtime.invalidateCredentials('client')
            const afterClientClear = await getMcpOAuthCredential(TEST_URL, settings)
            assert.strictEqual(afterClientClear.credential?.clientInformation, undefined)

            runtime.saveCodeVerifier('temp')
            await runtime.invalidateCredentials('verifier')
            expect(() => runtime.codeVerifier()).toThrow('OAuth code verifier is missing.')

            await runtime.invalidateCredentials('all')
            const afterAll = await getMcpOAuthCredential(TEST_URL, settings)
            assert.strictEqual(afterAll.credential?.tokens, undefined)
            assert.strictEqual(afterAll.credential?.clientInformation, undefined)
        })
    })
})

describe('oauth login flow', () => {
    test('rejects login when server uses bearer token env var', async () => {
        await expect(
            loginMcpServerOAuth({
                serverName: 'remote',
                config: {
                    type: 'streamable_http',
                    url: TEST_URL,
                    bearer_token_env_var: 'MCP_TOKEN',
                },
            }),
        ).rejects.toThrow('Remove it to use OAuth login.')
    })

    test('rejects login when OAuth discovery metadata is missing', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                return new Response('missing', { status: 404 })
            }),
        )

        await expect(
            loginMcpServerOAuth({
                serverName: 'remote',
                config: {
                    type: 'streamable_http',
                    url: TEST_URL,
                },
            }),
        ).rejects.toThrow('does not advertise OAuth support')
    })

    test('completes login flow with redirect callback and stores tokens', async () => {
        await withTempMemoHome(async (home) => {
            installDiscoveryFetch()
            const browserError = new Error('browser failed')
            spawnMock.mockReturnValue(spawnChild({ error: browserError }))
            const onAuthorizationUrl = vi.fn()
            const onBrowserOpenFailure = vi.fn()

            authMock.mockImplementationOnce(async (provider: any) => {
                setTimeout(() => {
                    void fetch(`${provider.redirectUrl}?code=oauth-code`)
                }, 0)
                await provider.redirectToAuthorization(new URL('https://auth.example.com/authorize?client_id=memo'))
                return 'REDIRECT'
            })
            authMock.mockImplementationOnce(async (provider: any, options: any) => {
                assert.strictEqual(options.authorizationCode, 'oauth-code')
                await provider.saveTokens({
                    access_token: 'oauth-token',
                    token_type: 'Bearer',
                })
                return 'AUTHORIZED'
            })

            const result = await loginMcpServerOAuth({
                serverName: 'remote',
                config: { type: 'streamable_http', url: TEST_URL },
                scopes: ['read,write', ' profile '],
                settings: { memoHome: home, storeMode: 'file', callbackPort: 41001 },
                onAuthorizationUrl,
                onBrowserOpenFailure,
            })

            assert.strictEqual(result.backend, 'file')
            expect(onAuthorizationUrl).toHaveBeenCalledWith('https://auth.example.com/authorize?client_id=memo')
            expect(onBrowserOpenFailure).toHaveBeenCalledWith(
                expect.any(Error),
                'https://auth.example.com/authorize?client_id=memo',
            )

            expect(authMock).toHaveBeenCalledTimes(2)
            expect(authMock.mock.calls[0]?.[1]?.scope).toBe('read write profile')

            const stored = await getMcpOAuthCredential(TEST_URL, {
                memoHome: home,
                storeMode: 'file',
            })
            assert.strictEqual(stored.credential?.tokens?.access_token, 'oauth-token')
        })
    })

    test('fails login when second auth step is not authorized', async () => {
        await withTempMemoHome(async () => {
            installDiscoveryFetch()
            spawnMock.mockReturnValue(spawnChild())

            authMock.mockImplementationOnce(async (provider: any) => {
                setTimeout(() => {
                    void fetch(`${provider.redirectUrl}?code=code-2`)
                }, 0)
                return 'REDIRECT'
            })
            authMock.mockResolvedValueOnce('REDIRECT')

            await expect(
                loginMcpServerOAuth({
                    serverName: 'remote',
                    config: { type: 'streamable_http', url: TEST_URL },
                    timeoutMs: 5_000,
                }),
            ).rejects.toThrow('OAuth authorization did not complete')
        })
    })

    test('fails login when auth succeeds but no token is persisted', async () => {
        await withTempMemoHome(async () => {
            installDiscoveryFetch()
            spawnMock.mockReturnValue(spawnChild())

            authMock.mockImplementationOnce(async (provider: any) => {
                setTimeout(() => {
                    void fetch(`${provider.redirectUrl}?code=code-3`)
                }, 0)
                return 'REDIRECT'
            })
            authMock.mockResolvedValueOnce('AUTHORIZED')

            await expect(
                loginMcpServerOAuth({
                    serverName: 'remote',
                    config: { type: 'streamable_http', url: TEST_URL },
                    timeoutMs: 5_000,
                }),
            ).rejects.toThrow('no access token was stored')
        })
    })
})
