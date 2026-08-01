import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readability } from '@mozilla/readability'
import ipaddr from 'ipaddr.js'
import { JSDOM } from 'jsdom'
import robotsParser from 'robots-parser'
import TurndownService from 'turndown'
import { ProxyAgent, type Dispatcher } from 'undici'
import { z } from 'zod'
import { textResult } from '@memo/core/tools/tools/mcp'
import { tool } from 'ai'

const WEBFETCH_INPUT_SCHEMA = z
    .object({
        url: z.string().min(1),
        max_length: z.number().int().positive().lt(1_000_000).optional(),
        start_index: z.number().int().min(0).optional(),
        raw: z.boolean().optional(),
        proxy_url: z.string().min(1).optional(),
    })
    .strict()

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 10
const ROBOTS_MAX_BODY_BYTES = 1_000_000
const DEFAULT_USER_AGENT = 'ModelContextProtocol/1.0 (Autonomous; +https://github.com/modelcontextprotocol/servers)'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BODY_BYTES = 5_000_000
const DEFAULT_MAX_LENGTH = 5_000
const DEFAULT_START_INDEX = 0

const turndownService = new TurndownService({
    headingStyle: 'atx',
})

type WebfetchRuntimeConfig = {
    userAgent: string
    ignoreRobotsTxt: boolean
    timeoutMs: number
    maxBodyBytes: number
    blockPrivateNet: boolean
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
    const value = raw?.trim()
    if (!value) return fallback
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return Math.floor(parsed)
}

function parseBool(raw: string | undefined, fallback: boolean) {
    const normalized = raw?.trim().toLowerCase()
    if (!normalized) return fallback
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
    return fallback
}

function getRuntimeConfig(): WebfetchRuntimeConfig {
    return {
        userAgent: process.env.MEMO_WEBFETCH_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
        ignoreRobotsTxt: parseBool(process.env.MEMO_WEBFETCH_IGNORE_ROBOTS_TXT, false),
        timeoutMs: parsePositiveInt(process.env.MEMO_WEBFETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
        maxBodyBytes: parsePositiveInt(process.env.MEMO_WEBFETCH_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
        blockPrivateNet: parseBool(process.env.MEMO_WEBFETCH_BLOCK_PRIVATE_NET, true),
    }
}

function isHttpUrl(url: URL) {
    return ALLOWED_PROTOCOLS.has(url.protocol)
}

function isBlockedIpRange(address: string) {
    const parsed = ipaddr.parse(address)
    if (parsed.kind() === 'ipv6') {
        if (parsed.range() === 'ipv4Mapped') {
            return isBlockedIpRange(parsed.toIPv4Address().toString())
        }
        return new Set(['uniqueLocal', 'linkLocal', 'loopback', 'unspecified', 'reserved']).has(parsed.range())
    }

    return new Set(['private', 'loopback', 'linkLocal', 'broadcast', 'carrierGradeNat', 'reserved', 'unspecified']).has(
        parsed.range(),
    )
}

async function assertPublicHost(url: URL) {
    const hostname = url.hostname.trim().toLowerCase()
    if (!hostname) throw new Error('URL host is empty')

    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new Error(`Blocked private or local network host: ${hostname}`)
    }

    if (isIP(hostname)) {
        if (isBlockedIpRange(hostname)) {
            throw new Error(`Blocked private or local network host: ${hostname}`)
        }
        return
    }

    let records: Awaited<ReturnType<typeof lookup>>
    try {
        records = await lookup(hostname, { all: true, verbatim: true })
    } catch (err) {
        throw new Error(
            `Failed to resolve host for private network protection (${hostname}): ${(err as Error).message}`,
        )
    }

    const resolved = Array.isArray(records) ? records : [records]
    if (resolved.length === 0) {
        throw new Error(`Failed to resolve host for private network protection (${hostname})`)
    }

    for (const record of resolved) {
        if (isBlockedIpRange(record.address)) {
            throw new Error(`Blocked private or local network host: ${hostname} (resolved to ${record.address})`)
        }
    }
}

async function readBodyWithLimit(response: Response, maxBodyBytes: number): Promise<string> {
    const declaredLengthRaw = response.headers.get('content-length')
    const declaredLength = declaredLengthRaw ? Number(declaredLengthRaw) : 0
    if (declaredLength > maxBodyBytes) {
        throw new Error(`Request rejected: response body too large (${declaredLength} bytes)`)
    }

    let consumedBytes = 0
    if (response.body && response.body.getReader) {
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue
            consumedBytes += value.byteLength
            if (consumedBytes > maxBodyBytes) {
                throw new Error(`Request aborted: response body exceeds ${maxBodyBytes} bytes`)
            }
            chunks.push(value)
        }
        const merged = new Uint8Array(consumedBytes)
        let offset = 0
        for (const chunk of chunks) {
            merged.set(chunk, offset)
            offset += chunk.byteLength
        }
        return new TextDecoder().decode(merged)
    }

    const text = await response.text()
    consumedBytes = new TextEncoder().encode(text).byteLength
    if (consumedBytes > maxBodyBytes) {
        throw new Error(`Request rejected: response body exceeds ${maxBodyBytes} bytes`)
    }
    return text
}

function buildFetchInit(signal: AbortSignal, userAgent: string, dispatcher: Dispatcher | undefined): RequestInit {
    return {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
            'User-Agent': userAgent,
        },
        ...(dispatcher ? ({ dispatcher } as RequestInit) : {}),
    }
}

async function fetchWithRedirects(
    initialUrl: URL,
    options: {
        userAgent: string
        timeoutMs: number
        maxBodyBytes: number
        dispatcher?: Dispatcher
        blockPrivateNet: boolean
    },
) {
    let currentUrl = new URL(initialUrl.toString())
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        if (options.blockPrivateNet) {
            await assertPublicHost(currentUrl)
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), options.timeoutMs)
        let response: Response
        try {
            response = await globalThis.fetch(
                currentUrl,
                buildFetchInit(controller.signal, options.userAgent, options.dispatcher),
            )
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                throw new Error(`Request timeout or aborted (${options.timeoutMs}ms)`)
            }
            throw err
        } finally {
            clearTimeout(timer)
        }

        if (!REDIRECT_STATUSES.has(response.status)) {
            const bodyText = await readBodyWithLimit(response, options.maxBodyBytes)
            return { response, bodyText, finalUrl: currentUrl }
        }

        if (redirectCount >= MAX_REDIRECTS) {
            throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`)
        }

        const location = response.headers.get('location')?.trim()
        if (!location) {
            throw new Error('Redirect response missing location header')
        }
        currentUrl = new URL(location, currentUrl)
    }

    throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`)
}

function looksLikeHtml(contentType: string, bodyText: string) {
    return /text\/html/i.test(contentType) || /^\s*<!doctype html/i.test(bodyText) || /^\s*<html[\s>]/i.test(bodyText)
}

function extractContentFromHtml(html: string, pageUrl: string) {
    const dom = new JSDOM(html, { url: pageUrl })
    try {
        const reader = new Readability(dom.window.document)
        const article = reader.parse()
        if (!article?.content) {
            return '<error>Page failed to be simplified from HTML</error>'
        }
        const markdown = turndownService.turndown(article.content).trim()
        return markdown || '<error>Page failed to be simplified from HTML</error>'
    } catch {
        return '<error>Page failed to be simplified from HTML</error>'
    } finally {
        dom.window.close()
    }
}

function getRobotsUrl(url: URL) {
    return new URL('/robots.txt', `${url.protocol}//${url.host}`)
}

async function checkRobots(
    url: URL,
    options: {
        userAgent: string
        timeoutMs: number
        dispatcher?: Dispatcher
        blockPrivateNet: boolean
    },
) {
    const robotsUrl = getRobotsUrl(url)
    let robotsResponse: { response: Response; bodyText: string }
    try {
        robotsResponse = await fetchWithRedirects(robotsUrl, {
            userAgent: options.userAgent,
            timeoutMs: options.timeoutMs,
            maxBodyBytes: ROBOTS_MAX_BODY_BYTES,
            dispatcher: options.dispatcher,
            blockPrivateNet: options.blockPrivateNet,
        })
    } catch (err) {
        throw new Error(
            `Failed to fetch robots.txt ${robotsUrl.toString()} due to a connection issue: ${(err as Error).message}`,
        )
    }

    const status = robotsResponse.response.status
    if (status === 401 || status === 403) {
        throw new Error(
            `When fetching robots.txt (${robotsUrl.toString()}), received status ${status} so assuming that autonomous fetching is not allowed, the user can try manually fetching by using the fetch prompt`,
        )
    }
    if (status >= 400 && status < 500) {
        return
    }

    const processedRobots = robotsResponse.bodyText
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n')
    const parsed = robotsParser(robotsUrl.toString(), processedRobots)
    const allowed = parsed.isAllowed(url.toString(), options.userAgent)
    if (allowed === false) {
        throw new Error(
            `The site's robots.txt (${robotsUrl.toString()}) specifies that autonomous fetching of this page is not allowed.`,
        )
    }
}

function formatPagedContent(content: string, startIndex: number, maxLength: number) {
    const originalLength = content.length
    if (startIndex >= originalLength) {
        return '<error>No more content available.</error>'
    }

    const truncated = content.slice(startIndex, startIndex + maxLength)
    if (!truncated) {
        return '<error>No more content available.</error>'
    }

    let result = truncated
    const consumed = truncated.length
    const remaining = originalLength - (startIndex + consumed)
    if (consumed === maxLength && remaining > 0) {
        const nextStart = startIndex + consumed
        result += `\n\n<error>Content truncated. Call the webfetch tool with a start_index of ${nextStart} to get more content.</error>`
    }
    return result
}

function buildProxyDispatcher(proxyUrl: URL | null): Dispatcher | undefined {
    if (!proxyUrl) return undefined
    return new ProxyAgent(proxyUrl.toString())
}

function closeDispatcher(dispatcher: Dispatcher | undefined) {
    if (!dispatcher) return
    if (typeof (dispatcher as { destroy?: () => void }).destroy === 'function') {
        ;(dispatcher as { destroy: () => void }).destroy()
    }
}

/**
 * Webfetch v2: paged HTTP fetch with optional markdown extraction and robots/security policy checks.
 */
export const webfetchTool = tool({
    description:
        'Fetch a URL, optionally simplify HTML to markdown, and return paged content with robots-aware policy checks.',
    inputSchema: WEBFETCH_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: true, isMutating: false } },

    execute: async (input) => {
        let url: URL
        try {
            url = new URL(input.url)
        } catch {
            return textResult(`Invalid URL: ${input.url}`, true)
        }
        if (!isHttpUrl(url)) {
            return textResult(`Unsupported protocol: ${url.protocol}`, true)
        }

        let proxyUrl: URL | null = null
        if (input.proxy_url) {
            try {
                proxyUrl = new URL(input.proxy_url)
            } catch {
                return textResult(`Invalid proxy URL: ${input.proxy_url}`, true)
            }
            if (!isHttpUrl(proxyUrl)) {
                return textResult(`Unsupported proxy protocol: ${proxyUrl.protocol}`, true)
            }
        }

        const maxLength = input.max_length ?? DEFAULT_MAX_LENGTH
        const startIndex = input.start_index ?? DEFAULT_START_INDEX
        const runtime = getRuntimeConfig()
        const dispatcher = buildProxyDispatcher(proxyUrl)

        try {
            if (!runtime.ignoreRobotsTxt) {
                await checkRobots(url, {
                    userAgent: runtime.userAgent,
                    timeoutMs: runtime.timeoutMs,
                    dispatcher,
                    blockPrivateNet: runtime.blockPrivateNet,
                })
            }

            const fetched = await fetchWithRedirects(url, {
                userAgent: runtime.userAgent,
                timeoutMs: runtime.timeoutMs,
                maxBodyBytes: runtime.maxBodyBytes,
                dispatcher,
                blockPrivateNet: runtime.blockPrivateNet,
            })

            if (fetched.response.status >= 400) {
                return textResult(`Failed to fetch ${url.toString()} - status code ${fetched.response.status}`, true)
            }

            const contentType = fetched.response.headers.get('content-type') || ''
            const html = looksLikeHtml(contentType, fetched.bodyText)
            const extractedContent =
                html && !input.raw
                    ? extractContentFromHtml(fetched.bodyText, fetched.finalUrl.toString())
                    : fetched.bodyText
            const prefix =
                html && !input.raw
                    ? ''
                    : `Content type ${contentType} cannot be simplified to markdown, but here is the raw content:\n`
            const pagedContent = formatPagedContent(extractedContent, startIndex, maxLength)
            return textResult(`${prefix}Contents of ${url.toString()}:\n${pagedContent}`)
        } catch (err) {
            return textResult(`Request failed: ${(err as Error).message}`, true)
        } finally {
            closeDispatcher(dispatcher)
        }
    },
})
