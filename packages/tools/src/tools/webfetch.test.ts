import assert from 'node:assert'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
    lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
import { webfetchTool } from '@memo/tools/tools/webfetch'

const dnsLookupMock = vi.mocked(lookup)
const WEBFETCH_ENV_KEYS = [
    'MEMO_WEBFETCH_USER_AGENT',
    'MEMO_WEBFETCH_IGNORE_ROBOTS_TXT',
    'MEMO_WEBFETCH_TIMEOUT_MS',
    'MEMO_WEBFETCH_MAX_BODY_BYTES',
    'MEMO_WEBFETCH_BLOCK_PRIVATE_NET',
]

type ToolResult = { isError?: boolean; content?: Array<{ type: string; text?: string }> }

function textPayload(result: ToolResult) {
    return result.content?.find((item) => item.type === 'text')?.text ?? ''
}

function installFetchMock(
    sequence: Array<Response | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response)>,
) {
    let idx = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const entry = sequence[idx]
        idx += 1
        if (!entry) {
            throw new Error(`Unexpected fetch call #${idx}`)
        }
        if (entry instanceof Response) return entry
        return await entry(input, init)
    })
    Object.assign(globalThis, { fetch: fetchMock as unknown as typeof globalThis.fetch })
    return fetchMock
}

describe('webfetch tool', () => {
    let originalFetch: typeof globalThis.fetch
    const previousEnv: Record<string, string | undefined> = {}

    beforeEach(() => {
        originalFetch = globalThis.fetch
        for (const key of WEBFETCH_ENV_KEYS) {
            previousEnv[key] = process.env[key]
            delete process.env[key]
        }
        dnsLookupMock.mockReset()
        dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    })

    afterEach(() => {
        Object.assign(globalThis, { fetch: originalFetch })
        for (const key of WEBFETCH_ENV_KEYS) {
            const value = previousEnv[key]
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    })

    test('requires url', async () => {
        const res = webfetchTool.validateInput?.({ url: '' })
        assert.ok(res && !res.ok)
    })

    test('rejects unsupported protocol', async () => {
        const res = await webfetchTool.execute({ url: 'file:///etc/hosts' })
        assert.strictEqual(res.isError, true)
        assert.ok(textPayload(res).includes('Unsupported protocol'))
    })

    test('rejects invalid proxy protocol', async () => {
        const res = await webfetchTool.execute({
            url: 'https://example.com',
            proxy_url: 'socks5://127.0.0.1:1080',
        })
        assert.strictEqual(res.isError, true)
        assert.ok(textPayload(res).includes('Unsupported proxy protocol'))
    })

    test('returns markdown content for html pages', async () => {
        installFetchMock([
            new Response('User-agent: *\nAllow: /', { status: 200 }),
            new Response('<html><body><article><h1>Hello</h1><p>World</p></article></body></html>', {
                status: 200,
                headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
        ])
        const res = await webfetchTool.execute({ url: 'https://example.com' })
        const text = textPayload(res)
        assert.strictEqual(res.isError, false)
        assert.ok(text.includes('Contents of https://example.com/'))
        assert.ok(text.includes('Hello'))
        assert.ok(text.includes('World'))
        assert.ok(!text.includes('<h1>'))
    })

    test('returns raw html when raw=true', async () => {
        installFetchMock([
            new Response('User-agent: *\nAllow: /', { status: 200 }),
            new Response('<html><body><h1>Hello</h1></body></html>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
        ])
        const res = await webfetchTool.execute({ url: 'https://example.com', raw: true })
        const text = textPayload(res)
        assert.strictEqual(res.isError, false)
        assert.ok(text.includes('cannot be simplified to markdown'))
        assert.ok(text.includes('<h1>Hello</h1>'))
    })

    test('returns raw content for non-html responses', async () => {
        installFetchMock([
            new Response('User-agent: *\nAllow: /', { status: 200 }),
            new Response('{"key":"value"}', {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        ])
        const res = await webfetchTool.execute({ url: 'https://example.com/data' })
        const text = textPayload(res)
        assert.strictEqual(res.isError, false)
        assert.ok(text.includes('cannot be simplified to markdown'))
        assert.ok(text.includes('{"key":"value"}'))
    })

    test('supports paging with truncation hint', async () => {
        installFetchMock([
            new Response('User-agent: *\nAllow: /', { status: 200 }),
            new Response('abcdefghij', {
                status: 200,
                headers: { 'content-type': 'text/plain' },
            }),
        ])
        const res = await webfetchTool.execute({
            url: 'https://example.com/data',
            start_index: 2,
            max_length: 4,
        })
        const text = textPayload(res)
        assert.strictEqual(res.isError, false)
        assert.ok(text.includes('cdef'))
        assert.ok(text.includes('start_index of 6'))
    })

    test('returns no-more-content when paging is out of range', async () => {
        installFetchMock([
            new Response('User-agent: *\nAllow: /', { status: 200 }),
            new Response('abc', {
                status: 200,
                headers: { 'content-type': 'text/plain' },
            }),
        ])
        const res = await webfetchTool.execute({
            url: 'https://example.com/data',
            start_index: 99,
        })
        assert.strictEqual(res.isError, false)
        assert.ok(textPayload(res).includes('<error>No more content available.</error>'))
    })

    test('robots 404 allows fetch', async () => {
        installFetchMock([
            new Response('not found', { status: 404 }),
            new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
        ])
        const res = await webfetchTool.execute({ url: 'https://example.com/data' })
        assert.strictEqual(res.isError, false)
        assert.ok(textPayload(res).includes('Contents of https://example.com/data'))
    })

    test('robots 403 blocks autonomous fetching', async () => {
        installFetchMock([new Response('blocked', { status: 403 })])
        const res = await webfetchTool.execute({ url: 'https://example.com/data' })
        assert.strictEqual(res.isError, true)
        assert.ok(textPayload(res).includes('autonomous fetching is not allowed'))
    })

    test('robots disallow blocks autonomous fetching', async () => {
        installFetchMock([new Response('User-agent: *\nDisallow: /', { status: 200 })])
        const res = await webfetchTool.execute({ url: 'https://example.com/data' })
        assert.strictEqual(res.isError, true)
        assert.ok(textPayload(res).includes("site's robots.txt"))
    })

    test('can ignore robots policy by env setting', async () => {
        process.env.MEMO_WEBFETCH_IGNORE_ROBOTS_TXT = '1'
        const fetchMock = installFetchMock([
            new Response('payload', {
                status: 200,
                headers: { 'content-type': 'text/plain' },
            }),
        ])
        const res = await webfetchTool.execute({ url: 'https://example.com/data' })
        assert.strictEqual(res.isError, false)
        assert.strictEqual(fetchMock.mock.calls.length, 1)
    })

    test('blocks localhost target', async () => {
        const fetchMock = vi.fn()
        Object.assign(globalThis, { fetch: fetchMock as unknown as typeof globalThis.fetch })
        const res = await webfetchTool.execute({ url: 'http://localhost:8080/private' })
        assert.strictEqual(res.isError, true)
        assert.ok(textPayload(res).includes('Blocked private or local network host'))
        assert.strictEqual(fetchMock.mock.calls.length, 0)
    })

    test('blocks domain resolving to private address', async () => {
        dnsLookupMock.mockResolvedValue([{ address: '10.0.0.12', family: 4 }] as never)
        const fetchMock = vi.fn()
        Object.assign(globalThis, { fetch: fetchMock as unknown as typeof globalThis.fetch })
        const res = await webfetchTool.execute({ url: 'https://example.com/private' })
        assert.strictEqual(res.isError, true)
        assert.ok(textPayload(res).includes('resolved to 10.0.0.12'))
        assert.strictEqual(fetchMock.mock.calls.length, 0)
    })

    test('can disable private network blocking by env setting', async () => {
        process.env.MEMO_WEBFETCH_BLOCK_PRIVATE_NET = '0'
        dnsLookupMock.mockResolvedValue([{ address: '10.0.0.12', family: 4 }] as never)
        installFetchMock([
            new Response('User-agent: *\nAllow: /', { status: 200 }),
            new Response('ok', {
                status: 200,
                headers: { 'content-type': 'text/plain' },
            }),
        ])
        const res = await webfetchTool.execute({ url: 'https://example.com/data' })
        assert.strictEqual(res.isError, false)
    })

    test('returns timeout error when request aborts', async () => {
        process.env.MEMO_WEBFETCH_TIMEOUT_MS = '5'
        installFetchMock([
            new Response('User-agent: *\nAllow: /', { status: 200 }),
            async (_input, init) =>
                await new Promise<Response>((_resolve, reject) => {
                    const signal = init?.signal
                    if (!signal) return
                    signal.addEventListener('abort', () => {
                        const err = new Error('aborted')
                        ;(err as Error & { name: string }).name = 'AbortError'
                        reject(err)
                    })
                }),
        ])
        const res = await webfetchTool.execute({ url: 'https://example.com/slow' })
        assert.strictEqual(res.isError, true)
        assert.ok(textPayload(res).includes('timeout or aborted'))
    })

    test('enforces response body max bytes', async () => {
        process.env.MEMO_WEBFETCH_MAX_BODY_BYTES = '10'
        installFetchMock([
            new Response('User-agent: *\nAllow: /', { status: 200 }),
            new Response('0123456789', {
                status: 200,
                headers: {
                    'content-type': 'text/plain',
                    'content-length': '100',
                },
            }),
        ])
        const res = await webfetchTool.execute({ url: 'https://example.com/large' })
        assert.strictEqual(res.isError, true)
        assert.ok(textPayload(res).includes('response body too large'))
    })

    test('fails on page http error status', async () => {
        installFetchMock([
            new Response('User-agent: *\nAllow: /', { status: 200 }),
            new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
        ])
        const res = await webfetchTool.execute({ url: 'https://example.com/missing' })
        assert.strictEqual(res.isError, true)
        assert.ok(textPayload(res).includes('status code 404'))
    })

    test('passes proxy dispatcher when proxy_url is provided', async () => {
        const fetchMock = installFetchMock([
            new Response('User-agent: *\nAllow: /', { status: 200 }),
            new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
        ])
        const res = await webfetchTool.execute({
            url: 'https://example.com/data',
            proxy_url: 'http://proxy.example.com:8080',
        })
        assert.strictEqual(res.isError, false)
        assert.strictEqual(fetchMock.mock.calls.length, 2)
        const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit & { dispatcher?: unknown }
        const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit & { dispatcher?: unknown }
        assert.ok(firstInit.dispatcher)
        assert.ok(secondInit.dispatcher)
    })
})
