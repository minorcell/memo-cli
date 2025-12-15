# 开发导向与思路（Core/Tools 优先）

目标：以 Core/Tools 为中心，形成可复用的 Agent 能力层，UI 只是薄壳。后续 CLI（Ink/React）、桌面（Electron）、Web/REST 都复用同一核心能力，避免重复造轮子。

## 核心原则

- **协议与契约先行**：优先完善 Core 的接口（Session/Turn、事件、工具协议、token 预算、hook）和 Tools 契约，UI 仅消费这些接口。
- **无 UI 耦合**：Core 不依赖 stdin/stdout/DOM，只暴露纯函数/事件流；Tools 也保持无 UI 偏好。
- **可观察性优先**：统一 JSONL 事件（assistant/action/observation/final/turn/session），便于任意前端/后端复用日志、调试。
- **安全与确定性**：工具输入校验、路径规范化、外部依赖前置检测（如 rg），避免 UI 层重做防护。
- **默认依赖内建**：Core 提供默认的 LLM/prompt/tokenizer/history sink/工具集装配，UI 只需提供回调，保持薄 UI（配置来自 `~/.memo/config.toml`）。

## 近期优先事项

1. Core

- 完善 Session/Turn API：hook（onTurnStart/onAction/onObservation/onFinal）、可选上下文截断策略。
- 提供摘要/截断策略接口，控制长上下文。
- 优化 token 计数：集中封装 tiktoken + usage 对账，暴露预算超限的策略钩子。
- 抽象历史 sink：文件 JSONL、stdout、可选远端（后续）。

2. Tools

- ✅ 补全输入校验与错误信息一致性。
- ⏳ 增加常用工具（时间、env、文件大小、hash 等），保持最小泄漏。
- ✅ 约定工具输出格式（简短、确定性），便于 UI 渲染。
- ✅ 加强隔离：路径白名单/只读模式、网络超时等。

3. 测试与 CI

- 继续用 `bun test` 覆盖解析、工具和 session 流程；mock LLM 以做单元测试。
- CI 运行全套测试，安装所需依赖（如 ripgrep）。

## UI 方向（示例，不锁定）

- CLI（Ink/React）：消费 Session/Turn 事件流，渲染消息、工具调用、token 用量。
- 桌面（Electron）：复用 Core/Tools，前端用 React/Vue，IPC 封装同样的事件。
- Web/REST：暴露 REST/WebSocket API，后端调用 Core，前端或第三方服务可直接消费。

## 接口/契约要点

- Session API：`createAgentSession(deps, options)` -> `{ runTurn, close, history }`；事件统一 JSONL 字段。
- 工具注册表：`ToolRegistry`（名称 -> ToolFn），输入为字符串（JSON），输出短文本。
- Prompt/Parser：已切换为 JSON 协议（action/final），保持可替换。
- 配置注入：模型参数、tokenizer、预算、工具开关通过 options/deps 注入，不写死在 Core。

## 建议的演进路线

1. 补强 Core hook/事件与上下文截断；为 JSONL sink 增加 stdout 选项便于开发。
2. Tools 安全/能力扩展，统一错误码/提示语；继续完善测试。
3. 提供无 UI 的 REST demo（最小 server），验证 Core 的纯粹性。
4. 迭代 Ink CLI 体验（流式渲染、折叠步骤、彩色日志），再探索桌面/Web。
