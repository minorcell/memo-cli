# llm 模块

职责：模型调用与 tokenizer。

- `openai.ts`：基于 OpenAI SDK 的客户端工厂 `createOpenAIClient(provider)`，兼容 DeepSeek/OpenAI；默认导出 `callLLM` 兼容旧接口。
- `tokenizer.ts`：tiktoken 封装，提供文本与消息的 token 计数。
