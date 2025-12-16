/** @file tiktoken 封装：用于提示词/回复 token 统计与编码管理。 */
import { encoding_for_model, get_encoding, type Tiktoken } from '@dqbd/tiktoken'
import type { ChatMessage, TokenCounter } from '@memo/core/types'

const DEFAULT_TOKENIZER_MODEL = 'cl100k_base'

type EncodingFactory = () => Tiktoken

function safeEncodingFactory(model?: string): { model: string; factory: EncodingFactory } {
    const resolvedModel = model?.trim() || DEFAULT_TOKENIZER_MODEL
    try {
        // encoding_for_model 需要严格的模型名；为兼容动态输入使用类型断言。
        const factory = () => encoding_for_model(resolvedModel as any)
        factory().free()
        return { model: resolvedModel, factory }
    } catch {
        // 对未知模型回退到通用 cl100k_base，避免抛出。
        const fallbackModel = DEFAULT_TOKENIZER_MODEL
        const factory = () => get_encoding(fallbackModel)
        factory().free()
        return { model: fallbackModel, factory }
    }
}

/** 创建一个可复用的 tokenizer 计数器，用于 prompt 估算与 usage 对账。 */
export function createTokenCounter(model?: string): TokenCounter {
    const { model: resolvedModel, factory } = safeEncodingFactory(model)
    const encoding = factory()

    // ChatML 粗略估算：每条消息包含 role/name 包装开销
    // 参考 OpenAI 对 gpt-3.5/4 的常用估算：每消息约 4 tokens，额外补足 assistant priming 2 tokens。
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
            total += countText(message.content)
            // 当前未使用 message.name，但预留 name 字段时加上开销
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
