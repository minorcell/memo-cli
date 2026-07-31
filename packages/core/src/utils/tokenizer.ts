/** @file tiktoken wrapper for token estimation. Used for compaction triggering, context overflow checks, and tool result sizing — not for usage reporting. */
import { encoding_for_model, get_encoding, type Tiktoken } from '@dqbd/tiktoken'
import type { ChatMessage, TokenCounter } from '@memo/core/types'

const DEFAULT_TOKENIZER_MODEL = 'cl100k_base'

type EncodingFactory = () => Tiktoken

function safeEncodingFactory(model?: string): { model: string; factory: EncodingFactory } {
    const resolvedModel = model?.trim() || DEFAULT_TOKENIZER_MODEL
    try {
        // encoding_for_model requires strict model names; using type assertion for dynamic input compatibility.
        const factory = () => encoding_for_model(resolvedModel as any)
        factory().free()
        return { model: resolvedModel, factory }
    } catch {
        // Fallback to generic cl100k_base for unknown models to avoid throwing.
        const fallbackModel = DEFAULT_TOKENIZER_MODEL
        const factory = () => get_encoding(fallbackModel)
        factory().free()
        return { model: fallbackModel, factory }
    }
}

function messagePayloadForCounting(message: ChatMessage): string {
    if (message.role === 'assistant') {
        const parts = Array.isArray(message.content) ? message.content : []
        const text =
            typeof message.content === 'string'
                ? message.content
                : parts
                      .filter((part) => part.type === 'text')
                      .map((part) => part.text)
                      .join('')
        const reasoning = parts
            .filter((part) => part.type === 'reasoning')
            .map((part) => part.text)
            .join('\n')
        const toolCalls = parts.filter((part) => part.type === 'tool-call')
        const reasoningSuffix = reasoning ? `\n${reasoning}` : ''
        if (toolCalls.length) {
            return `${text}${reasoningSuffix}\n${JSON.stringify(toolCalls)}`
        }
        return `${text}${reasoningSuffix}`
    }
    if (message.role === 'tool') {
        const part = Array.isArray(message.content) ? message.content[0] : undefined
        const text = part?.type === 'tool-result' && part.output.type === 'text' ? part.output.value : ''
        const toolCallId = part?.type === 'tool-result' ? part.toolCallId : ''
        const toolName = part?.type === 'tool-result' ? part.toolName : ''
        return `${text}\n${toolCallId}\n${toolName}`
    }
    return typeof message.content === 'string' ? message.content : ''
}

/** Create a reusable token counter for prompt size estimation (compaction trigger, context overflow check). */
export function createTokenCounter(model?: string): TokenCounter {
    const { model: resolvedModel, factory } = safeEncodingFactory(model)
    const encoding = factory()

    // ChatML rough estimation: each message includes role/name wrapping overhead
    // Reference OpenAI's common estimates for gpt-3.5/4: about 4 tokens per message, plus 2 tokens for assistant priming.
    const TOKENS_PER_MESSAGE = 4
    const TOKENS_FOR_ASSISTANT_PRIMING = 2
    const TOKENS_PER_NAME = 1

    const countText = (text: string) => {
        if (!text) return 0
        return encoding.encode(text).length
    }

    const countMessages = (messages: ChatMessage[]) => {
        if (!messages.length) return 0
        let total = 0
        for (const message of messages) {
            total += TOKENS_PER_MESSAGE
            total += countText(messagePayloadForCounting(message))
            // Currently not using message.name, but add overhead when name field is reserved
            if ((message as any).name) {
                total += TOKENS_PER_NAME
            }
        }
        total += TOKENS_FOR_ASSISTANT_PRIMING
        return total
    }

    return {
        model: resolvedModel,
        countText,
        countMessages,
        dispose: () => encoding.free(),
    }
}
