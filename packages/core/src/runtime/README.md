# runtime 模块

职责：会话运行时、默认依赖注入、提示词与历史记录。

- `prompt.xml/prompt.ts`：系统提示词模板与加载。
- `history.ts`：JSONL 历史 sink 与事件构造。
- `defaults.ts`：补全工具集、LLM、prompt、history sink、tokenizer、maxSteps（基于配置）。
- `session.ts`：Session/Turn 状态机，执行 ReAct 循环、写事件、统计 token、触发回调。
