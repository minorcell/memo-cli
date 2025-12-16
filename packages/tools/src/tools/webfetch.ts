import { z } from 'zod'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

const WEBFETCH_INPUT_SCHEMA = z
    .object({
        url: z.string().min(1),
    })
    .strict()

type WebFetchInput = z.infer<typeof WEBFETCH_INPUT_SCHEMA>

const WEBFETCH_TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 512_000
const MAX_BODY_PREVIEW = 4_000
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'data:'])
const HTML_BREAK_TAG =
    /<\/\s*(p|div|section|article|header|footer|aside|main|h[1-6]|li|tr|table|blockquote)\s*>/gi
const HTML_LINE_BREAK = /<\s*(br|hr)\s*\/?>/gi
const HTML_LIST_ITEM = /<\s*li[^>]*>/gi
const HTML_TAG = /<[^>]+>/g
const HTML_SCRIPT_STYLE = /<(script|style)[^>]*>[\s\S]*?<\/\s*\1>/gi

const decodeEntities = (input: string) => {
    const base = input
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")

    const numeric = base.replace(/&#(x?[0-9a-fA-F]+);/g, (_, code: string) => {
        try {
            const value =
                code.startsWith('x') || code.startsWith('X')
                    ? parseInt(code.slice(1), 16)
                    : parseInt(code, 10)
            return Number.isFinite(value) ? String.fromCharCode(value) : ''
        } catch {
            return ''
        }
    })

    return numeric
}

const htmlToPlainText = (html: string) => {
    const withoutScriptStyle = html.replace(HTML_SCRIPT_STYLE, ' ')
    const withBreaks = withoutScriptStyle
        .replace(HTML_LIST_ITEM, '- ')
        .replace(HTML_LINE_BREAK, '\n')
        .replace(HTML_BREAK_TAG, '\n')
    const stripped = withBreaks.replace(HTML_TAG, ' ')
    const decoded = decodeEntities(stripped)

    const lines = decoded
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim().replace(/[ \t]{2,}/g, ' '))
    const normalizedLines = lines.filter(
        (line, idx) => line.length > 0 || (idx > 0 && (lines[idx - 1]?.length ?? 0) > 0),
    )
    return normalizedLines.join('\n').trim()
}

const sanitizePreview = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * WebFetch：受限 HTTP GET，返回纯文本（会对 HTML 进行去标签与解码），带超时与大小限制。
 */
export const webfetchTool: McpTool<WebFetchInput> = {
    name: 'webfetch',
    description: 'HTTP GET 请求，返回处理后的纯文本正文（自动剥离 HTML 标签）',
    inputSchema: WEBFETCH_INPUT_SCHEMA,
    execute: async (input) => {
        let url: URL
        try {
            url = new URL(input.url)
        } catch {
            return textResult(`无效 URL: ${input.url}`, true)
        }
        if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
            return textResult(`不支持的协议: ${url.protocol}`, true)
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), WEBFETCH_TIMEOUT_MS)
        try {
            const res = await globalThis.fetch(url, { signal: controller.signal })
            const lengthHeader = res.headers.get('content-length')
            const declaredLength = lengthHeader ? Number(lengthHeader) : undefined
            if (declaredLength && declaredLength > MAX_BODY_BYTES) {
                return textResult(`请求被拒绝: 响应体过大（${declaredLength} bytes）`, true)
            }

            let consumedBytes = 0
            let bodyText = ''

            if (res.body && res.body.getReader) {
                const reader = res.body.getReader()
                const chunks: Uint8Array[] = []
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    if (!value) continue
                    consumedBytes += value.byteLength
                    if (consumedBytes > MAX_BODY_BYTES) {
                        controller.abort()
                        return textResult(`请求被中止: 响应体超过 ${MAX_BODY_BYTES} bytes`, true)
                    }
                    chunks.push(value)
                }
                const merged = new Uint8Array(consumedBytes)
                let offset = 0
                for (const chunk of chunks) {
                    merged.set(chunk, offset)
                    offset += chunk.byteLength
                }
                bodyText = new TextDecoder().decode(merged)
            } else {
                bodyText = await res.text()
                consumedBytes = new TextEncoder().encode(bodyText).byteLength
                if (consumedBytes > MAX_BODY_BYTES) {
                    return textResult(`请求被拒绝: 响应体超过 ${MAX_BODY_BYTES} bytes`, true)
                }
            }

            const contentType = res.headers.get('content-type') || ''
            const looksLikeHtml =
                /text\/html/i.test(contentType) ||
                /^\s*<!doctype html/i.test(bodyText) ||
                /^\s*<html[\s>]/i.test(bodyText)

            const plainText = looksLikeHtml ? htmlToPlainText(bodyText) : bodyText.trim()
            const normalizedText = sanitizePreview(plainText)

            const preview =
                normalizedText.length > MAX_BODY_PREVIEW
                    ? `${normalizedText.slice(0, MAX_BODY_PREVIEW)}...`
                    : normalizedText
            const truncatedNote =
                normalizedText.length > MAX_BODY_PREVIEW ? ' text_truncated=true' : ''
            const formatNote = looksLikeHtml ? ' source=html_stripped' : ''

            return textResult(
                `status=${res.status} bytes=${consumedBytes} text_chars=${normalizedText.length} text="${preview}"${truncatedNote}${formatNote}`,
            )
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                return textResult(`请求超时或被中止（${WEBFETCH_TIMEOUT_MS}ms）`, true)
            }
            return textResult(`请求失败: ${(err as Error).message}`, true)
        } finally {
            clearTimeout(timer)
        }
    },
}
