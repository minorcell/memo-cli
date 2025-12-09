# memo-cli 的 Token 计数策略

本文说明 memo-cli 如何估算与记录 token，用于提示词预算、超限防护和 usage 对账。

## 计数实现

- **底层编码器**：使用 `@dqbd/tiktoken`，默认 encoding `cl100k_base`；可通过 `tokenizerModel` 覆盖。
- **纯文本计数**：`countText(text)` 直接对字符串编码，获得长度。
- **消息数组计数（ChatML 近似）**：`countMessages(messages)` 采用 OpenAI ChatML 常用估算：
    - 每条消息固定开销 4 tokens（role/name 封装等）。
    - `content` 本身按 tiktoken 编码计数。
    - 如果后续支持 `name` 字段，则额外加 1 token。
    - 末尾补充 2 tokens 用于 assistant priming。

该策略比单纯串联文本更贴近实际 ChatML 开销，但仍是近似值。

## 使用场景

- **提示词预算**：`runTurn` 会在每步前用 `countMessages` 估算 prompt tokens，触发：
    - `warnPromptTokens`：打印警告。
    - `maxPromptTokens`：超过时立即返回提示，避免向 LLM 发送超限请求。
- **usage 对账**：每步会结合本地计数与模型返回的 `usage`（若提供），记录到 tokenUsage 与 JSONL 历史事件。

## 精度与局限

- ChatML 不同模型的固定开销略有差异，当前采用「每消息 4 + 末尾 2」的通用估算，可能与特定模型存在 ±几十 token 的偏差。
- 未显式处理工具调用/函数调用的额外结构开销，如需精确对账可在未来针对具体模型定制 constants。
- 若使用自定义 `callLLM`，建议传入对应模型的 encoding 名称或自定义 `tokenCounter` 以匹配真实开销。

## 如何覆盖

- 创建 Session 时传入 `tokenizerModel` 或直接注入自定义 `tokenCounter`：

```ts
import { createTokenCounter, createAgentSession } from '@memo/core'

const tokenCounter = createTokenCounter('gpt-4o-mini')
const session = await createAgentSession({ tokenCounter }, { warnPromptTokens: 8_000 })
```

- 自定义 counter 只需实现 `countText`、`countMessages`、`dispose` 接口。
