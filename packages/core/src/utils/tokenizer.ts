/** @file Token estimation for compaction triggering and context overflow checks — not for usage reporting. */
import type { ChatMessage, TokenCounter } from '@memo/core/types'
import { Tiktoken } from 'js-tiktoken/lite'
import cl100k from 'js-tiktoken/ranks/cl100k_base'

// cl100k_base covers OpenAI-compatible models (and is the closest general-purpose
// encoding for compatible providers). Loaded lazily once and cached: the vocab is
// ~1MB and encoding calls are sync. Any load failure falls back to the byte
// estimate below so the counter always works.
let encoding: Tiktoken | null = null
let encodingLoadFailed = false

function getEncodingCached(): Tiktoken | null {
    if (encoding) return encoding
    if (encodingLoadFailed) return null
    try {
        encoding = new Tiktoken(cl100k)
    } catch {
        encodingLoadFailed = true
    }
    return encoding
}

// OpenAI's common approximation: 1 token ≈ 4 bytes (UTF-8).
// CJK chars are ~3 bytes each, so the estimate stays within range for Chinese too.
const BYTES_PER_TOKEN = 4

const encoder = new TextEncoder()

/** Rough token count for plain text: ceil(utf8 bytes / 4). Fallback when tiktoken is unavailable. */
function approxTokenCount(text: string): number {
    if (!text) return 0
    return Math.ceil(encoder.encode(text).length / BYTES_PER_TOKEN)
}

// Fixed structural overhead per message (role wrapper + delimiters), added on top
// of the encoded content when tiktoken is available.
const STRUCTURAL_TOKENS_PER_MESSAGE = 3

function encodeText(enc: Tiktoken, text: string): number {
    try {
        return enc.encode(text).length
    } catch {
        return approxTokenCount(text)
    }
}

function countMessageTokens(message: ChatMessage): number {
    const enc = getEncodingCached()
    if (!enc) {
        return approxTokenCount(JSON.stringify(message))
    }

    let count = STRUCTURAL_TOKENS_PER_MESSAGE
    const content = message.content
    if (typeof content === 'string') {
        count += encodeText(enc, content)
        return count
    }
    for (const part of content) {
        switch (part.type) {
            case 'text':
            case 'reasoning':
                count += encodeText(enc, part.text)
                break
            case 'tool-call':
                count += encodeText(enc, part.toolName) + encodeText(enc, JSON.stringify(part.input))
                break
            case 'tool-result':
                count += encodeText(enc, part.toolName)
                count +=
                    part.output.type === 'text'
                        ? encodeText(enc, part.output.value)
                        : encodeText(enc, JSON.stringify(part.output))
                break
        }
    }
    return count
}

/** Create a token counter for prompt size estimation (compaction trigger, context overflow check). */
export function createTokenCounter(): TokenCounter {
    return {
        countText: (text: string) => {
            if (!text) return 0
            const enc = getEncodingCached()
            if (enc) return encodeText(enc, text)
            return approxTokenCount(text)
        },
        countMessages: (messages: ChatMessage[]) =>
            messages.reduce((sum, message) => sum + countMessageTokens(message), 0),
    }
}
