# Core 实现解读

本文聚焦「XML 约定 + 状态机」这一核心运行机制，解释模型输出如何被解析成动作或终止信号，以及 `runAgent` 如何据此驱动工具调用。希望读者即使脱离代码，也能理解代理的协议和执行流程。

## 核心机制：XML 协议驱动的状态机

1. **系统提示词约束输出**：`prompt.xml` 明确要求模型使用 `<thought>` 解释思考、`<action tool="...">` 触发工具、或 `<final>` 给出答案。
2. **解析模型输出**：`parseAssistant` 用正则抽取 `<action>` 与 `<final>`，二者都有可能同时存在。
3. **状态流转**：
    - 抽到 `<final>`：流程结束，返回答案。
    - 抽到 `<action tool="X">payload</action>`：查找工具 `X` 并执行，得到 observation。
    - 无法解析出 action/final：视为模型失效，跳出循环，走兜底答案。
4. **Observation 回写**：工具结果被包装成 `<observation>...</observation>` 写回对话（作为 user 消息），逼迫模型在下一轮基于观察继续推理或收敛到 `<final>`。
5. **循环防护**：`max_steps` 由配置决定（config.toml，默认 100），限制单个 turn 内的 step 数；缺少匹配工具时也会以 `"未知工具: X"` 的 observation 继续，让模型自我纠正。

### 标签职责一览

- `<thought>`：模型自我思考，纯文本，不被程序消费，仅供人类/日志阅读。
- `<action tool="name">input</action>`：被解析为待执行的工具调用，input 直接传入工具函数。
- `<observation>...</observation>`：程序生成，写回历史，告诉模型工具产物。
- `<final>...</final>`：终止信号，直接作为最终回答。
- `<message role="..."><![CDATA[...]]></message>`：日志包装格式，用于落盘历史，防止特殊符号破坏 XML。

## 入口：Session/Turn API（createAgentSession）

核心入口是 `createAgentSession(deps, options)`，返回 Session 对象，调用 `runTurn` 执行单轮 ReAct 循环。UI 自行决定跑多少 turn（如 `--once` 只跑一轮），Core 只在 turn 内通过 `MAX_STEPS` 限制 step 数，防止模型空转。

要点：

- **注入式依赖**：`tools`（默认内置工具集）、`callLLM`（默认 OpenAI/DeepSeek）、`loadPrompt`（默认 prompt.xml）、`historySinks`（默认 JSONL）、`tokenCounter` 等可省略，Core 会补齐默认实现；`onAssistantStep/onObservation` 供 UI 订阅。
- **循环与防护**：`MAX_STEPS` 默认 100，限制单个 turn 的 step 数；若既无 `<action>` 也无 `<final>`，立即跳出。
- **Observation 回写**：工具输出被包装为 `<observation>...` 写回对话，促使模型收敛。
- **未知工具提示**：未注册的工具会写入 `"未知工具: xxx"` 继续引导模型修正。

## 提示词加载（packages/core/src/runtime/prompt.ts & prompt.xml）

- `loadSystemPrompt()` 读取内置的 XML 模板 `prompt.xml`，可被依赖注入覆盖。
- 模板中定义：
    - 可用工具列表及参数约定（bash/read/write/edit/glob/grep/fetch）。
    - 响应格式：`<thought>`、`<action tool="...">`、等待 `<observation>`、或 `<final>`。
    - 约束：每轮仅用一个工具、未知工具时也需保持 XML 格式等。

## 模型输出解析（packages/core/src/utils.ts）

- `parseAssistant(content)` 使用正则抽取 `<action tool="...">...</action>` 与 `<final>...</final>`，返回 `{ action?, final? }`，两者可能同时存在，调用方自行判断优先级。
- `escapeCData` 与 `wrapMessage` 将任意消息包装成 `<message role="..."><![CDATA[...]]></message>`，确保日志中的特殊符号不会破坏 XML。
- 解析策略是「宽松正则」而非严格 XML 解析器，优点是简单鲁棒，缺点是无法校验嵌套/属性正确性；因此提示词中需清晰告知模型格式要求。

## 历史与日志（packages/core/src/runtime/history.ts）

- 提供 JSONL 历史 sink（`JsonlHistorySink`）和事件构造器 `createHistoryEvent`，用于结构化落盘。
- `runAgent` 返回的 `logEntries` 仅用于兼容旧 XML 复盘需求，默认 CLI 不再写 XML。

## LLM 适配（packages/core/src/llm/openai.ts）

- `callOpenAICompatible(messages)` 使用 OpenAI Chat Completions 协议，默认 Base URL 指向 DeepSeek（`https://api.deepseek.com`），默认模型 `deepseek-chat`。
- API Key 读取顺序：`OPENAI_API_KEY` → `DEEPSEEK_API_KEY`（便于兼容 OpenAI/DeepSeek）。
- 可用环境变量：`OPENAI_BASE_URL`（默认 DeepSeek）、`OPENAI_MODEL`（默认 deepseek-chat）。
- 模型请求由 OpenAI SDK 发送（默认 BaseURL 深度寻址 https://api.deepseek.com），调用方可通过 `OPENAI_BASE_URL/OPENAI_MODEL` 覆盖。

## 工具协议与注册表

- 类型定义见 `packages/core/src/types.ts`：
    - `ToolFn = (input: string) => Promise<string>`，`ToolRegistry = Record<string, ToolFn>`。
    - `CallLLM` 与 `AgentDeps` 约束了 runAgent 所需的全部依赖。
- 默认工具集合由 `packages/tools` 暴露的 `TOOLKIT` 提供（bash/read/write/edit/glob/grep/fetch），Core 仅按名称查找，不关心具体实现。

## 上层如何使用（packages/ui/src/index.ts 示例）

CLI 层组装依赖并调用：

```ts
const deps = {
    tools: TOOLKIT,
    callLLM: callOpenAICompatible,
    loadPrompt: loadSystemPrompt,
    onAssistantStep: (text, step) => console.log(`[LLM 第 ${step + 1} 轮输出]\\n${text}`),
}
const result = await runAgent(userQuestion, deps)
```

这样 Core 保持纯调度与协议处理，UI/工具/模型均可被替换或扩展。
