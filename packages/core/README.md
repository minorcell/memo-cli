# @memo/core 概览

Core 提供 Memo Agent 的核心能力：ReAct 循环、会话状态管理、默认依赖装配（LLM/工具/提示词/历史记录）、配置加载，以及公共类型/工具。设计目标是“厚 Core、薄 UI”：UI 只做交互与回调，其他行为均由 Core 负责。

## 目录结构

- `config/`
    - `config.ts`：读取 `~/.memo/config.toml`（providers、max_steps、sessions 路径），提供 provider 选择、会话路径构建、配置写入。
    - `constants.ts`：兜底常量（如 MAX_STEPS 默认值）。
- `runtime/`
    - `prompt.ts/xml`：系统提示词加载。
    - `history.ts`：JSONL 历史 sink 与事件构造。
    - `defaults.ts`：默认依赖补全（工具集、LLM、prompt、history sink、tokenizer、maxSteps）。
    - `session.ts`：Session/Turn 运行时，执行 ReAct 循环、事件写入、token 统计。
- `types.ts`：公共类型定义（AgentDeps、Session/Turn、TokenUsage、HistoryEvent 等）。
- `utils/`：
    - 工具函数（解析 assistant 输出、消息包装）。
    - `tokenizer.ts`：基于 tiktoken 的 tokenizer 工具。
- `index.ts`：包入口，导出核心模块与类型。

## 关键流程

- `createAgentSession(deps, options)`：创建 Session，补全默认依赖，加载 prompt，返回可 `runTurn` 的对象。`max_steps` 取自配置或 options。
- `withDefaultDeps`：根据配置与可选覆盖，注入默认工具集、LLM 客户端、prompt、history sink（写入 `~/.memo/sessions/YY/MM/DD/<uuid>.jsonl`）、tokenizer。
- 会话记录：JSONL 事件（session_start/turn_start/assistant/action/observation/final/turn_end/session_end），包含 provider、模型、tokenizer、token 用量等元数据。
- 配置：`~/.memo/config.toml`（可用 `MEMO_HOME` 自定义位置），缺省时会触发 UI 引导创建。

## 使用方式（示意）

```ts
import { createAgentSession } from "@memo/core"

const session = await createAgentSession({ onAssistantStep: console.log }, { mode: "once" })
const turn = await session.runTurn("你好")
await session.close()
```

如果提供自定义工具/LLM/prompt/sink，可在 deps/options 中覆盖对应字段。默认配置会选择当前 provider 并写入用户目录的 sessions。
