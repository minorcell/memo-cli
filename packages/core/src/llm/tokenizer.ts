import { encoding_for_model, get_encoding, type Tiktoken } from "@dqbd/tiktoken"
import type { ChatMessage, TokenCounter } from "@memo/core/types"

const DEFAULT_TOKENIZER_MODEL = "cl100k_base"

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

    const countText = (text: string) => {
        if (!text) return 0
        return encoding.encode(text).length
    }

    const countMessages = (messages: ChatMessage[]) => {
        if (!messages.length) return 0
        // 粗略策略：将 role 与内容串联，便于统一计数
        const joined = messages.map((m) => `${m.role}: ${m.content}`).join("\n")
        return countText(joined)
    }

    return {
        model: resolvedModel,
        countText,
        countMessages,
        dispose: () => encoding.free(),
    }
}
