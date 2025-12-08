# Core 实现解读（现状）

核心聚焦「XML 协议 + 状态机」，通过 Session/Turn API 驱动工具调用、记录 JSONL 事件，依赖默认从 `~/.memo/config.toml` 补齐（provider、max_steps、日志路径等），UI 只需处理交互与回调。

## 目录/模块

- `config/`：配置与路径
  - `config.ts`：读取/写入 `~/.memo/config.toml`，provider 选择（name/env_api_key/model/base_url）、会话路径 `sessions/YY/MM/DD/<uuid>.jsonl`、sessionId 生成。
  - `constants.ts`：兜底默认（如 MAX_STEPS）。
- `runtime/`：运行时与日志
  - `prompt.xml/prompt.ts`：系统提示词加载。
  - `history.ts`：JSONL sink 与事件构造。
  - `defaults.ts`：补全工具集、LLM、prompt、history sink、tokenizer、maxSteps（基于配置）。
  - `session.ts`：Session/Turn 状态机，执行 ReAct 循环、写事件、统计 token、触发回调。
- `llm/`：模型与 tokenizer
  - `openai.ts`：OpenAI SDK 适配，`createOpenAIClient(provider)` 基于配置生成客户端，兼容 DeepSeek/OpenAI。
  - `tokenizer.ts`：tiktoken 封装。
- `utils/`：解析工具（assistant 输出解析、消息包装）。
- `types.ts`：公共类型。
- `index.ts`：包入口，导出上述模块。

## 核心机制：XML 协议驱动的状态机

1. 系统提示词要求模型使用 `<thought>`、`<action tool="...">`、`<final>`。
2. `parseAssistant` 抽取 `<action>` / `<final>`。
3. 状态流转：
   - `<final>`：结束，返回答案。
   - `<action tool="X">payload</action>`：执行工具，得到 observation。
   - 无 action/final：跳出，走兜底。
4. Observation 回写：`<observation>...</observation>` 作为 user 消息写回，引导模型继续。
5. 循环防护：`max_steps` 来自配置（默认 100），限制单个 turn 内 step 数；未知工具写 `"未知工具: X"` 继续纠偏。

标签职责：
- `<thought>`：思考，程序不消费。
- `<action tool="name">input</action>`：要调用的工具和入参。
- `<observation>...</observation>`：程序生成，告诉模型工具产物。
- `<final>...</final>`：终止信号。
- `<message role="..."><![CDATA[...]]></message>`：历史包装，防止字符破坏 XML。

## 入口：Session/Turn API（createAgentSession）

- `createAgentSession(deps, options)` 返回 Session；`runTurn` 执行单轮 ReAct，UI 控制轮次（如 `--once` 只跑一轮）。
- 默认依赖补全：`tools`（内置工具集）、`callLLM`（基于 provider 的 OpenAI 客户端）、`loadPrompt`、`historySinks`（写 `~/.memo/sessions/...`）、`tokenCounter`、`maxSteps` 均可省略。
- 配置来源：`~/.memo/config.toml`（`MEMO_HOME` 可覆盖），字段 `current_provider`、`providers` 数组、`max_steps`。缺失时 UI 会交互式引导生成。
- 回调：`onAssistantStep`、`onObservation` 供 UI 实时渲染。

简例：
```ts
import { createAgentSession } from "@memo/core"

const session = await createAgentSession({ onAssistantStep: console.log }, { mode: "once" })
const turn = await session.runTurn("你好")
await session.close()
```

## 历史与日志（runtime/history.ts）

- 事件：`session_start/turn_start/assistant/action/observation/final/turn_end/session_end`。
- 默认写入 `~/.memo/sessions/YY/MM/DD/<uuid>.jsonl`；包含 provider、模型、tokenizer、token 用量等元数据。
- XML 落盘已废弃；`logEntries` 仅为兼容用途。

## LLM 适配（llm/openai.ts）

- `createOpenAIClient(provider)` 基于 provider 配置（env_api_key/model/base_url）构建 OpenAI SDK 客户端。
- 环境变量只存 API key，不写入配置；可用 `OPENAI_BASE_URL/OPENAI_MODEL` 临时覆盖。

## 工具协议与注册表

- `ToolFn = (input: string) => Promise<string>`，`ToolRegistry = Record<string, ToolFn>`。
- 默认工具集来自 `packages/tools` (`TOOLKIT`)，Core 按名称查找，未知工具会提示 `"未知工具: name"`。

## 配置与路径（config/config.ts）

- `loadMemoConfig`：读取 `~/.memo/config.toml`，返回配置/路径以及 `needsSetup` 标记。
- `writeMemoConfig`：将配置写回。
- `buildSessionPath`：生成日期分桶的 JSONL 路径。
- `selectProvider`：按名称选择 provider，回退默认。

## 小结

Core 提供“一站式默认装配 + 可插拔依赖”，UI 只关心交互。配置/日志放在用户目录，避免污染仓库，支持多 provider 与 token 预算控制。 
