import { z } from 'zod'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

const FETCH_INPUT_SCHEMA = z
    .object({
        url: z.string().min(1),
    })
    .strict()

type FetchInput = z.infer<typeof FETCH_INPUT_SCHEMA>

const FETCH_TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 512_000
const MAX_BODY_PREVIEW = 4_000
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'data:'])

/**
 * 发起受限的 HTTP GET 请求，带超时、大小与协议限制，避免长时间挂起或过大响应。
 */
export const fetchTool: McpTool<FetchInput> = {
    name: 'fetch',
    description: 'HTTP GET 请求，返回状态码与正文',
    inputSchema: FETCH_INPUT_SCHEMA,
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
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
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

            const preview =
                bodyText.length > MAX_BODY_PREVIEW
                    ? `${bodyText.slice(0, MAX_BODY_PREVIEW)}...`
                    : bodyText
            const truncatedNote = bodyText.length > MAX_BODY_PREVIEW ? ' body_truncated=true' : ''

            return textResult(
                `status=${res.status} bytes=${consumedBytes} body="${preview}"${truncatedNote}`,
            )
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                return textResult(`请求超时或被中止（${FETCH_TIMEOUT_MS}ms）`, true)
            }
            return textResult(`请求失败: ${(err as Error).message}`, true)
        } finally {
            clearTimeout(timer)
        }
    },
}
