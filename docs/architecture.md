# Agent 架构设计提案（UI / Core / Tools 三层）

目标：分层解耦，便于替换 UI、扩展工具（含 MCP）、切换/新增 LLM，提升可维护性与可测试性。

## 分层概览

- **UI 包**（例如 `packages/ui`）：基于 React + Ink 的 CLI 交互层。负责用户输入、对话渲染、工具调用进度/结果展示、配置选择（模型、温度、启用工具集等）。不包含业务逻辑，仅消费 Core 暴露的接口。
- **Core 包**（例如 `packages/core`）：Agent 业务核心。职责：会话状态机（ReAct 循环、MAX_STEPS）、系统提示词加载、历史记录、日志包装、模型客户端接口（LLMClient 抽象）、工具调用协议（Tool 接口与注册表契约）、错误/超时处理。对工具实现无感，仅依赖工具接口。
- **Tools 包**（例如 `packages/tools`）：提供具体工具集合和适配层。职责：内置本地工具（read/write/edit/glob/grep/bash/fetch/time 等）、MCP server 适配（将 MCP 的 resource/template 暴露为工具）、安全与约束（路径规范化、文件大小/超时限制）。对 UI/Core 无耦合，仅通过 Tool 接口对外。

## 核心接口与数据流

- `ToolFn`: `(input: string) => Promise<string>`；`ToolName` 受控枚举。Tools 包提供 `getToolkit(): Record<ToolName, ToolFn>`。
- `LLMClient`: `chat(messages: ChatMessage[], options?): Promise<string>`；Core 注入具体实现（如 DeepSeek、后续其他模型）。
- `runAgent(question, deps)`：Core 暴露的主调度函数，依赖注入 `{ tools, llmClient, logger, historyWriter, promptLoader, maxSteps }`；可扩展为 async generator 以便 UI 流式渲染。
- 历史记录与提示词：Core 内部通过接口 `loadPrompt()`、`writeHistory(logs)`，由 UI/上层提供路径或实现，避免硬编码。
- 错误与日志：Core 提供结构化 log 回调（如 `onStep`, `onTool`, `onFinal`），UI 可订阅绘制。

## 包职责切分

### UI

- CLI 入口（Ink 渲染）：输入框、消息流、工具调用/观测日志、状态指示、配置选择。
- 将用户输入转换为 `runAgent` 调用；监听事件/回调流，更新视图。
- 环境变量/配置读取（API Key、默认工具集选择、温度等），注入 Core/LLM。

### Core

- ReAct 循环：解析 `<action>/<final>`，调度工具，处理 observation，控制 MAX_STEPS。
- Prompt/History：加载系统提示词，落盘 XML/JSON 历史（可插拔 writer）。
- LLM 客户端：抽象接口，DeepSeek 实现只是其中之一；可插流式输出。
- 防御性逻辑：未知工具提示、超步数退出、错误兜底。

### Tools

- 内置工具：read/write/edit/glob/grep/bash/fetch/getTime 等，统一输入 JSON、输出简短文本或结构化字符串。
- MCP 适配：为 MCP server 暴露的资源/模板生成 ToolFn，注入到工具集。
- 安全与约束：路径 normalize、大小/超时限制、可选只读模式，避免破坏性操作。

## 目录/包建议（Monorepo）

- `packages/core`: `index.ts`（runAgent）、`llm/`（DeepSeek 实现）、`prompt/`、`history/`、`parser/`、`types/`。
- `packages/tools`: `tools/`（各工具实现）、`mcp/`（适配器）、`types/`。
- `packages/ui`: Ink 界面、CLI 入口、配置加载。
- 根目录：workspace 配置（pnpm/bun workspaces）、通用脚本（lint/test/build）。

## 演进路线（增量迁移）

1. 抽 Core：将现有主循环/提示词/历史/解析迁移到 `packages/core`，暴露 `runAgent` 与类型。
2. 抽 Tools：将工具实现移至 `packages/tools`，暴露 `getToolkit`。
3. 抽 LLM：将 DeepSeek 客户端移至 Core 的 `llm/deepseek`，Core 通过接口依赖注入。
4. UI 替换：新增 `packages/ui`（Ink），封装 CLI 输入与渲染，调用 Core。
5. MCP 接入：在 Tools 包添加 MCP 适配器，统一注册。
6. 配置与测试：统一配置加载（API Key、路径、超时），补充单元测试（解析、工具、防御逻辑），为工具/LLM 添加模拟实现以便离线测试。

## 关键注意点

- 依赖注入：Core 不直接读取全局 env/文件，改由调用方注入配置/实现。
- API 与安全：工具默认使用绝对/规范化路径；对大文件/二进制加限制；bash/grep 等提供超时或禁止某些命令（可选）。
- 输出契约：工具输出尽量短、确定性；LLM 接口返回字符串或流，UI 负责渲染。
- 可观测性：设计日志钩子便于 UI/调试；历史 writer 可替换为无落盘模式。
- 扩展性：ToolName/LLM 模型列表集中管理；提示词模板可多版本（不同模型或策略）。
