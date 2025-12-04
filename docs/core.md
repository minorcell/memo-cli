# Core 实现解读

本文聚焦「XML 约定 + 状态机」这一核心运行机制，解释模型输出如何被解析成动作或终止信号，以及 `runAgent` 如何据此驱动工具调用。希望读者即使脱离代码，也能理解代理的协议和执行流程。

## 核心机制：XML 协议驱动的状态机

1) **系统提示词约束输出**：`prompt.xml` 明确要求模型使用 `<thought>` 解释思考、`<action tool="...">` 触发工具、或 `<final>` 给出答案。  
2) **解析模型输出**：`parseAssistant` 用正则抽取 `<action>` 与 `<final>`，二者都有可能同时存在。  
3) **状态流转**：
   - 抽到 `<final>`：流程结束，返回答案。
   - 抽到 `<action tool="X">payload</action>`：查找工具 `X` 并执行，得到 observation。
   - 无法解析出 action/final：视为模型失效，跳出循环，走兜底答案。
4) **Observation 回写**：工具结果被包装成 `<observation>...</observation>` 写回对话（作为 user 消息），逼迫模型在下一轮基于观察继续推理或收敛到 `<final>`。
5) **循环防护**：最多 `MAX_STEPS`（默认 100）轮，避免死循环；缺少匹配工具时也会以 `"未知工具: X"` 的 observation 继续，让模型自我纠正。

### 标签职责一览
- `<thought>`：模型自我思考，纯文本，不被程序消费，仅供人类/日志阅读。
- `<action tool="name">input</action>`：被解析为待执行的工具调用，input 直接传入工具函数。
- `<observation>...</observation>`：程序生成，写回历史，告诉模型工具产物。
- `<final>...</final>`：终止信号，直接作为最终回答。
- `<message role="..."><![CDATA[...]]></message>`：日志包装格式，用于落盘历史，防止特殊符号破坏 XML。

## 入口：runAgent（packages/core/src/index.ts）

`runAgent(question, deps)` 是主调度函数，按「读取提示词 → 建立初始对话 → 循环解析 XML → 调度工具/终止」的流程运行。外部通过依赖注入传入工具集、模型调用、提示词/日志实现等。伪代码（强调状态转移而非具体代码）：

```ts
const systemPrompt = await loadPrompt()
log("system", systemPrompt)
log("user", question)
history = [
  { role: "system", content: systemPrompt },
  { role: "user", content: question },
]

for step in [0..MAX_STEPS):
  assistantText = await callLLM(history)
  onAssistantStep?.(assistantText, step)
  log("assistant", assistantText)
  parsed = parseAssistant(assistantText)

  if parsed.final:
    return { answer: parsed.final, logEntries }      // 终止

  if parsed.action:
    toolFn = tools[parsed.action.tool]
    observation = toolFn ? await toolFn(parsed.action.input) : `未知工具: ${...}`
    log("observation", observation)
    history.push({                                    // 将 observation 作为 user 消息回写
      role: "user",
      content: `<observation>${observation}</observation>`,
    })
    continue                                          // 下一轮

  break // 未产生 action/final，防止空转

// 兜底失败提示
return { answer: "未能生成最终回答，请重试或调整问题。", logEntries }
```

要点：
- **注入式依赖**：`tools`（工具注册表）、`callLLM`（模型客户端）、`loadPrompt`、`writeHistory`、`historyFilePath`、`onAssistantStep` 均从 `AgentDeps` 传入，Core 不直接依赖外部环境变量或 IO。
- **循环与防护**：`MAX_STEPS` 默认 100，避免模型进入死循环；若既无 `<action>` 也无 `<final>`，立即跳出。
- **Observation 回写**：工具输出被包装为 `<observation>...` 重新写入对话，诱导模型继续推理或收敛到 `<final>`。
- **未知工具提示**：当模型要求的工具未注册时，直接写入 `"未知工具: xxx"`，保持协议完整。

## 提示词加载（packages/core/src/prompt.ts & prompt.xml）

- `loadSystemPrompt()` 读取内置的 XML 模板 `prompt.xml`，可被依赖注入覆盖。
- 模板中定义：
  - 可用工具列表及参数约定（bash/read/write/edit/glob/grep/fetch）。
  - 响应格式：`<thought>`、`<action tool="...">`、等待 `<observation>`、或 `<final>`。
  - 约束：每轮仅用一个工具、未知工具时也需保持 XML 格式等。

## 模型输出解析（packages/core/src/utils.ts）

- `parseAssistant(content)` 使用正则抽取 `<action tool="...">...</action>` 与 `<final>...</final>`，返回 `{ action?, final? }`，两者可能同时存在，调用方自行判断优先级。
- `escapeCData` 与 `wrapMessage` 将任意消息包装成 `<message role="..."><![CDATA[...]]></message>`，确保日志中的特殊符号不会破坏 XML。
- 解析策略是「宽松正则」而非严格 XML 解析器，优点是简单鲁棒，缺点是无法校验嵌套/属性正确性；因此提示词中需清晰告知模型格式要求。

## 历史与日志（packages/core/src/history.ts）

- `writeHistory(logEntries, filePath)` 将累积的 `<message>` 片段写成 XML 文件，默认路径 `history.xml`，包含 `startedAt` 时间戳，方便离线复盘。
- `runAgent` 自身不直接写盘，而是返回 `logEntries` 供上层决定是否调用 `writeHistory`，避免核心逻辑与 IO 绑定。

## LLM 适配（packages/core/src/llm/openai.ts）

- `callOpenAICompatible(messages)` 使用 OpenAI Chat Completions 协议，默认 Base URL 指向 DeepSeek（`https://api.deepseek.com`），默认模型 `deepseek-chat`。
- API Key 读取顺序：`OPENAI_API_KEY` → `DEEPSEEK_API_KEY`（便于兼容 OpenAI/DeepSeek）。
- 可用环境变量：`OPENAI_BASE_URL`（默认 DeepSeek）、`OPENAI_MODEL`（默认 deepseek-chat）。
- 请求发送与错误处理由 `utils/request.ts` 的 `requestJson` 封装：自动序列化 body、填充 Content-Type、非 2xx 抛错。

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
  writeHistory: logs => writeHistory(logs, HISTORY_FILE),
  onAssistantStep: (text, step) => console.log(`[LLM 第 ${step + 1} 轮输出]\\n${text}`),
}
const result = await runAgent(userQuestion, deps)
```

这样 Core 保持纯调度与协议处理，UI/工具/模型均可被替换或扩展。
