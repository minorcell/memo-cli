# 多轮对话架构设计（Session / Turn）

目标：让 CLI 从「单次问题即退出」演进为「进程级 Session、包含多个 Turn 的交互式对话」，同时兼容一次性模式（`--once`），并产出可消费的 JSONL 历史。

## 背景与痛点

- 当前 `packages/ui/src/index.ts` 只接受一次问题，调用 `runAgent` 后直接退出，无法继续追问或补充上下文。
- 日志仅有 `history.xml`，无法按消息维度索引/分析，也难以和其他系统对接。
- 缺少 Session/Turn 概念，无法区分同一进程内的多轮、或复盘某一轮的工具轨迹。

## 目标与范围

- 提供「Session（进程级对话）」「Turn（用户输入到 `<final>` 的一次往返）」的统一数据结构。
- 默认交互式 REPL，持续接收用户输入；`--once` 保持单轮运行后退出。
- Session/Turn 事件写入 JSONL，便于检索、拼装、观察性能；兼容历史的 XML 落盘。
- 不改变现有 ReAct 协议（XML 标签、单工具调用），优先做架构和存储改造。

## 核心概念与状态

- **Session**：进程级对话上下文。
    - `sessionId`（如 nanoid）、`mode`（interactive|once）、`startedAt/endedAt`、`config`（模型、温度、工具开关、工作目录等）。
    - `chatHistory: ChatMessage[]`：沿用 Core 的历史格式，包含 system 提示、用户输入、助手输出、observation 回写。
    - 日志：`session_start` / `session_end` 事件包裹整个生命周期。
- **Turn**：一次用户输入到模型给出 `<final>` 或兜底退出的完整循环。
    - `turnIndex`（从 1 开始）、`userInput`、`startedAt/endedAt`、`status`（ok|error|max_steps）、`finalText`、`stepCount`。
    - 每个 Turn 内包含若干 **Step**（对模型的一次响应解析）。
- **Step**：ReAct 循环内的单次模型响应。
    - `stepIndex`、`assistantText`（原始 LLM 输出）、`parsedAction`、`parsedFinal`、`observation`（若有）、`tool`（若有）。
    - 这些细粒度事件写入 JSONL，`chatHistory` 仅保留必要的 user/assistant/observation 消息以支撑后续轮次。

## 运行模式与 CLI 行为

- **交互模式（默认）**：
    - `bun start` 或 `bun run packages/ui/src/index.ts` 启动 Session，打印 `sessionId`。
    - 可选第一个问题来自 argv，其余问题从 stdin 读取；支持 `/exit`、`/help` 之类的指令退出或查看状态。
    - 每个 Turn 结束后继续等待输入，直到用户退出或遇到致命错误。
- **一次性模式（`--once`）**：
    - `bun start "hello" --once`：启动 Session，但只跑 `turnIndex=1`，拿到 `<final>` 或兜底后退出。
    - 仍写 JSONL / XML 日志，Session 中只有一个 Turn。

## 流程设计（Session 管理）

1. **Session 创建**：读取配置、生成 `sessionId`、加载系统 prompt，将 `session_start` 事件写入 JSONL。
2. **Turn Start**：
    - 将用户输入 push 到 `chatHistory`（role=user）。
    - 写入 `turn_start` 事件（含原始输入、turnIndex）。
3. **ReAct 循环**（复用 `runAgent` 内部逻辑，或将其下沉为 `runTurn`）：
    - 调用 `callLLM(history)` 得到 `assistantText`，记 `assistant` 事件。
   - `parseAssistant`：若有 `<action>`，执行工具，写入 `action` / `observation` 事件，并将 `<observation>` 作为 user 消息回写；若有 `<final>`，写入 `final` 事件并结束 Turn。
   - 仍受 `max_steps`（配置项，默认 100）限制，超限写 `turn_end`（status=max_steps）。
4. **Turn End**：
    - 将最终 `<final>` 内容以 assistant 消息写入 `chatHistory`，方便下一轮续对话。
    - 写入 `turn_end` 事件（status、stepCount、durationMs、errorMessage?）。
5. **Session End**：退出时写 `session_end` 事件，并可选落盘 XML 汇总。

## Core 改造要点

- 抽象 `AgentSession`：
    - `createAgentSession(deps, options): AgentSession`，持有 `chatHistory`、事件 writer。
    - `runTurn(userInput): TurnResult`：内部复用现有循环；返回 final 文本、step 列表、状态码；将 assistant final 写回历史。
    - `close()`：收尾写入 `session_end`，flush writer。
- 保持 `runAgent(question, deps)` 作为 `--once` 的薄封装，内部调用 `createAgentSession(...).runTurn(question)`，保证向后兼容。
- 历史写入接口扩展：
    - 新增 `HistorySink`（`append(event)` / `flush()`），提供 `JsonlHistorySink` 与现有 XML writer（可作为 `LegacyXmlSink`）并存。
    - `AgentDeps` 可注入 `historySinks: HistorySink[]`，交给 Session 在关键事件时写入。

## UI/CLI 改造要点

- CLI 入口变为 REPL：监听 stdin、维持 Session 实例、逐 Turn 调用 `runTurn`；`--once` 则跳过循环。
- 渲染策略：沿用 `onAssistantStep` 打印每次模型输出；工具调用与 observation 也同步打印，便于可视化。
- 命令行参数：`--once`（单轮后退出）；其余参数通过代码配置或默认值控制。

## Token 计数与预算策略

选择方案：**主力使用本地 tokenizer（@dqbd/tiktoken）做预估与限流，辅以 LLM 返回的 usage 作为对账**。理由：

- 预估可在发请求前完成，便于拒绝/截断过长输入；LLM usage 只能事后拿到，且不同厂商字段不一致。
- @dqbd/tiktoken 可在 Bun/Node 侧运行，稳定、开销小；流式/离线场景也能计算。
- 仍保留对 `response.usage` 的记录，用于校验/审计，但不依赖它做硬限制。

落地点：

- Core Session 层维护 `tokenUsage`：`promptTokens`、`completionTokens`、`totalTokens`，分级累计（step/turn/session）。
- 在每次 `callLLM` 前，用 tiktoken 对当前 `chatHistory` + 最新 user 输入做预估；若超过 `maxPromptTokens`，可选策略：a) 拒绝并要求用户缩短；b) 做窗口截断/摘要（后续扩展）。
- 在得到 LLM 响应后，记录 `response.usage`（若存在），并用本地 tokenizer 对 assistant 内容做补记，兼容无 usage 的模型。
- JSONL 事件中写入 `meta.tokens`，方便后续统计/成本分析。
- CLI 增加配置：`--max-prompt-tokens`、`--warn-prompt-tokens`、`--tokenizer-model`（传给 tiktoken 的 encoding 名称）。

## JSONL 事件格式设计

每行一条事件，字段固定，便于后续落 ES/ClickHouse 等：

- 公共字段：`ts`（ISO）、`session_id`、`turn`（数字，从 1 开始）、`step`（数字，从 0 开始，限于 turn 内）、`type`（见下）、`content`（字符串）、`role`（system|user|assistant，可选）、`meta`（对象，放工具名、耗时、token 等）。
- 事件类型示例：
    - `session_start` / `session_end`：`meta` 包含 `mode`、`config`（模型、温度、工作目录、工具开关、tokenizer）。
    - `turn_start`：`content` 为原始用户输入；`meta.tokens.prompt` 为 user 输入的预估 tokens。
    - `assistant`：模型原文输出；`meta.tokens` 记录本地/usage 的 completion/prompt/total。
    - `action`：`meta.tool`、`meta.input`（raw）；`content` 可为空或简述。
    - `observation`：`meta.tool`、`content` 为工具返回。
    - `final`：`content` 为 `<final>` 文本；`meta.tokens` 可包含本轮累计。
    - `turn_end`：`meta` 包含 `status`、`stepCount`、`durationMs`、`errorMessage?`、`tokens`（该 turn 累计）。

示例（简化）：

```jsonl
{"ts":"2024-05-10T12:00:00Z","session_id":"sess_x","type":"session_start","meta":{"mode":"interactive","model":"deepseek-chat","tokenizer":"cl100k_base"}}
{"ts":"2024-05-10T12:00:05Z","session_id":"sess_x","turn":1,"type":"turn_start","content":"帮我读 README","meta":{"tokens":{"prompt":12}}}
{"ts":"2024-05-10T12:00:06Z","session_id":"sess_x","turn":1,"step":0,"type":"assistant","content":"<thought>需要 read...</thought><action tool=\"read\">...","meta":{"tokens":{"prompt":120,"completion":35,"total":155}}}
{"ts":"2024-05-10T12:00:06Z","session_id":"sess_x","turn":1,"step":0,"type":"action","meta":{"tool":"read","input":"/repo/README.md"}}
{"ts":"2024-05-10T12:00:06Z","session_id":"sess_x","turn":1,"step":0,"type":"observation","meta":{"tool":"read"},"content":"(文件片段)"}
{"ts":"2024-05-10T12:00:08Z","session_id":"sess_x","turn":1,"step":1,"type":"final","content":"README 摘要...","meta":{"tokens":{"completion":28}}}
{"ts":"2024-05-10T12:00:08Z","session_id":"sess_x","turn":1,"type":"turn_end","meta":{"status":"ok","stepCount":2,"durationMs":3000,"tokens":{"prompt":132,"completion":63,"total":195}}}
{"ts":"2024-05-10T12:05:00Z","session_id":"sess_x","type":"session_end"}
```

## 历史文件与兼容性

- 默认写入 `history/<sessionId>.jsonl`，便于一 Session 一文件；`--log-dir` 可定制路径。
- XML 仅保留为核心的兼容写入工具，但默认 CLI 不再落盘 XML，专注 JSONL 结构化日志。
- 旧接口（返回 `logEntries`）保持不变，便于需要 XML 的场景自行调用。

## 开放问题与后续

- 长 Session 的上下文膨胀：是否需要 Turn 级摘要或截断策略？
- 工具错误是否中断 Turn？需要一个 `policy`（跳过/终止/重试）字段。
- 需要流式 LLM 输出时，Step 级事件是否拆分为 chunk？当前设计按完整响应落日志，可后续加 `assistant_chunk`。
