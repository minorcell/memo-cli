/** @file Byte-based token estimation (codex-style: ceil(utf8 bytes / 4)). Used for compaction triggering and context overflow checks — not for usage reporting. */
import type { ChatMessage, TokenCounter } from '@memo/core/types'

// OpenAI's common approximation: 1 token ≈ 4 bytes (UTF-8).
// CJK chars are ~3 bytes each, so the estimate stays within range for Chinese too.
const BYTES_PER_TOKEN = 4

const encoder = new TextEncoder()

/** Rough token count for plain text: ceil(utf8 bytes / 4). Coarse estimate, not tokenizer-accurate. */
function approxTokenCount(text: string): number {
    if (!text) return 0
    return Math.ceil(encoder.encode(text).length / BYTES_PER_TOKEN)
}

/** Rough token count for a message array: sum of JSON-serialized per-message byte estimates (includes structure overhead). */
function approxMessageTokenCount(messages: ChatMessage[]): number {
    let total = 0
    for (const message of messages) {
        total += approxTokenCount(JSON.stringify(message))
    }
    return total
}

/** Create a token counter for prompt size estimation (compaction trigger, context overflow check). */
export function createTokenCounter(): TokenCounter {
    return {
        countText: approxTokenCount,
        countMessages: approxMessageTokenCount,
    }
}
