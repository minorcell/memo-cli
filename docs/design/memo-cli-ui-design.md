# memo-cli UI 设计

## 1. 目标与范围

- 以 Gemini CLI 的 TUI 体验为参考，但保持 UI 薄壳，只消费 Core 的 Session/Turn 与 hooks。
- 支持两种运行形态：交互式 TUI（默认）与非交互输出（--once 或非 TTY）。
- 强化工具调用与 token 使用可视化，提升调试与可观测性。
- 不修改 Core/Tools 协议与行为，UI 不侵入业务逻辑。

## 2. 当前能力分析（memo-cli）

### 2.1 Core 运行时与协议

- Session/Turn 状态机，严格 JSON 协议（action 或 final），有 max_steps 保护。
- hooks 完整：onTurnStart/onAction/onObservation/onFinal。
- 通过 onAssistantStep 支持流式输出（stream 模式）。
- JSONL 事件齐全：session_start/turn_start/assistant/action/observation/final/turn_end/session_end。

### 2.2 配置与默认依赖

- 配置文件：~/.memo/config.toml（可用 MEMO_HOME 覆盖）。
- Provider 体系：current_provider、providers、model/base_url/env_api_key。
- 默认装配：工具集、LLM client、tokenizer、history sink。
- stream_output 由配置驱动；token 预算与阈值来自 SessionOptions。

### 2.3 工具与 MCP

- 内置工具：bash/read/write/edit/glob/grep/webfetch/save_memory/time/todo。
- MCP 外部工具来自 config.mcp*servers，自动注入 prompt，命名为 <server>*<tool>。
- 工具返回以文本为主，UI 需做扁平化展示。

### 2.4 可观测性与限制

- tiktoken 计数，支持 warnPromptTokens/maxPromptTokens。
- JSONL 按 session 记录事件，便于审计与回放。
- Core 可脱离 UI 运行，UI 可独立演进。

### 2.5 现有 UI 状态与缺口

- 目前仅 readline，支持 --once、/exit、简单输出。
- 无布局、无消息列表、无工具调用分组、无滚动管理。
- 无命令补全/历史检索，交互效率低。

## 3. 可复用的 Gemini CLI UI 思路

- React + Ink 作为 TUI 渲染基础。
- 类 AppContainer 的 UI 状态管理器。
- Context/Hook 划分（输入、滚动、会话、快捷键）。
- InputPrompt：命令补全 + 历史搜索 + 建议列表。
- 工具调用分组与状态流转（pending/executing/success/error）。
- alternate buffer 支持，退出时还原终端状态。

## 4. UI 架构方案（memo-cli）

### 4.1 总体流程

1. CLI 入口完成配置引导与 provider 初始化。
2. 创建 AgentSession（传入 hooks 与 onAssistantStep）。
3. 交互模式启动 TUI 渲染器；非交互直接输出文本。
4. hooks 触发 UI 状态更新，按 turn/step 渲染。

### 4.2 状态模型

- SessionState
    - sessionId, mode, provider, model, streamOutput, startedAt
- TurnState
    - index, userInput, steps[], status, tokenUsage, durationMs
- StepState
    - index, assistantText(流式缓冲), action, observation, tokenUsage
- UIState
    - focus, scrollOffset, suggestions, inputBuffer, notices

### 4.3 Core 到 UI 的事件映射

| Core hook/回调  | UI 事件        | UI 结果                          |
| --------------- | -------------- | -------------------------------- |
| onTurnStart     | TurnStart      | 新增 turn，显示用户输入          |
| onAssistantStep | AssistantChunk | 追加流式输出缓冲                 |
| onAction        | ToolCall       | 渲染工具调用卡片，状态 executing |
| onObservation   | ToolResult     | 渲染工具结果，状态 success/error |
| onFinal         | Final          | 固化助手消息与 token 统计        |

### 4.4 错误处理

- LLM/工具失败：在当前 turn 内展示错误块，保留上下文。
- 未捕获错误：顶部红色提示条，尽量不退出 UI。
- Ctrl+C：若有进行中的 turn 则中断；空闲则退出。

## 5. 布局与组件设计

### 5.1 交互式布局示意

```
--------------------------------------------------------------+
| memo-cli  session:<id>  provider:model  mode  stream  time  |
--------------------------------------------------------------+
| Turn 3                                                       |
| User: summarize repo                                         |
| Assistant: ... (streaming)                                   |
| Tool: grep  status=running                                   |
|   input: {"pattern":"TODO","path":"./"}                      |
|   output: ...                                                |
| Final: ...                                                   |
|                                                              |
| Turn 4 ...                                                   |
--------------------------------------------------------------+
| tokens: p 1234  c 456  t 1690  step 2/100                   |
| > 输入你的问题...                                            |
--------------------------------------------------------------+
```

### 5.2 组件划分

- AppShell
    - HeaderBar
    - MainContent
    - StatusBar
    - InputPrompt
- HeaderBar
    - SessionBadge（id/mode）
    - ProviderBadge（provider/model）
    - StreamIndicator
    - 运行时长或时钟
- MainContent
    - TurnGroup
        - UserMessage
        - AssistantMessage（流式）
        - ToolCallPanel（可折叠）
        - ObservationBlock
        - FinalMessage
- StatusBar
    - TokenUsageBadge
    - StepCounter
    - WarningIndicator（token 超限或工具错误）
- InputPrompt
    - TextBuffer
    - SuggestionList（命令/历史/路径）
    - InlineHelp（可选）

### 5.3 ToolCallPanel 行为

- 默认折叠：显示工具名 + 状态 + 简短入参摘要。
- 展开：显示完整 JSON 入参与输出。
- 快捷键（示例）：Ctrl+O 展开/折叠最近工具调用。

### 5.4 流式渲染

- 流式输出直接追加到当前 AssistantMessage。
- 非流式模式一次性展示完整回答。
- 显示“typing”指示或动态光标。

## 6. 交互设计

### 6.1 输入与快捷键

- Enter：提交
- Shift+Enter：换行
- Up/Down：输入历史
- Ctrl+R：历史搜索（可选）
- Ctrl+L：清屏
- Ctrl+C：中断/退出

### 6.2 UI 级 Slash 命令

MVP：

- /help：显示命令与快捷键
- /exit：退出 session
- /clear：清屏
- /tools：列出工具（内置 + MCP）
- /config：显示 config 路径与当前 provider

后续：

- /memory：显示 memo.md 位置与摘要
- /sessions：列出 JSONL 会话文件
- /log：tail 当前 JSONL
- /theme：切换主题
- /model：切换 provider/model（下次 turn 生效）

## 7. 视觉与可用性规范

- 仅使用 3-4 种语义色：用户/助手/工具/错误。
- 保持输出稳定可复制，不依赖复杂 ANSI 动效。
- 屏幕狭窄时自动压缩 header 与工具卡片。
- 非 TTY 下禁用 TUI，输出纯文本。

## 8. 非交互模式

- --once 或非 TTY：不启动 Ink。
- 输出顺序：
    - 用户输入（可选）
    - assistant final
    - token 汇总
- 工具调用与 observation 以纯文本块打印，便于审计。

## 9. 实施阶段

Phase 1（MVP）：

- Ink 布局：Header/Main/Status/Input。
- 流式输出与基础工具卡片。
- /help、/exit、/clear、/tools、/config。

Phase 2：

- 命令补全与建议列表。
- 工具卡片折叠与错误徽标。
- token 预警在 StatusBar 提示。

Phase 3：

- 会话浏览与日志查看。
- 主题与配色配置。
- 鼠标与滚动支持（若 Ink 可控）。

## 10. 待确认问题

- Bun 运行 Ink 是否稳定？是否需要 Node 模式兜底？
- 是否引入“高危工具确认”机制（例如写文件/执行命令）？
- 是否需要专门的 headless 输出模式（更适配 CI/piping）？
