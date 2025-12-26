# memo-cli

终端内的 ReAct Agent，基于 Bun + TypeScript。它附带 Session/Turn 状态机、标准 JSON 协议提示、结构化 JSONL 日志、内置工具编排，并默认对接 DeepSeek（OpenAI 兼容接口）。你可以按需接入任意 OpenAI 兼容 Provider 以及 MCP 工具。

**全新 TUI 界面**：提供现代化的终端用户界面，支持实时流式输出、工具调用可视化、token 使用统计和交互式命令。

## 预备知识

- 需要 [Bun](https://bun.sh/)（建议 1.1+）和可用的 OpenAI 兼容 API Key。
- 配置、历史日志与缓存写在 `~/.memo/`，设置 `MEMO_HOME` 可以迁移目录。
- 第一次运行会引导生成 `~/.memo/config.toml` 并选择默认 Provider。

## 核心特性

- **现代化 TUI 界面**：基于 React + Ink 构建的终端用户界面，支持实时流式输出、工具调用可视化、token 使用统计和交互式命令。
- **Session/Turn 多轮控制**：交互式 TUI + `--once` 单轮模式，支持会话恢复。
- **JSON 协议 ReAct**：强制模型输出 `{"thought":"","action":{...}}` 或 `{"final":""}`，驱动工具调用与回答。
- **结构化日志**：所有事件写入 JSONL（token 计数、工具 observation、LLM 元数据）。
- **Token 预算**：用 `tiktoken` 估算 prompt，结合 LLM usage，对超限做提示或拒绝。
- **内置工具 + MCP 扩展**：提供文件/系统/网络/记忆工具，并自动注入配置的 MCP 工具前缀。
- **智能交互**：支持命令补全、输入历史、快捷键操作和丰富的 Slash 命令。

## 架构概览

采用清晰的关注点分离架构：核心逻辑位于 `packages/core`，UI 层负责交互与可视化。

1. **配置层**（`config/`）：读取/写入 `~/.memo/config.toml`，选择 Provider，生成会话路径。
2. **运行时**（`runtime/`）：`session.ts` 执行 ReAct 循环，`history.ts` 写事件，`prompt.ts` 维护 JSON 协议提示。
3. **默认依赖**（`runtime/defaults.ts`）：拼装工具注册表、OpenAI SDK 的 `callLLM`、token counter、`maxSteps` 与日志 sink。
4. **Hooks & Middlewares**：通过 `createAgentSession` 的 `onAssistantStep`、`hooks.onAction`、`onFinal` 等回调订阅生命周期。
5. **UI 层**（`packages/ui/`）：基于 React + Ink 的 TUI 界面，提供实时可视化、交互式命令和状态管理。

```ts
import { createAgentSession } from '@memo/core'

const session = await createAgentSession({ onAssistantStep: console.log })
await session.runTurn('你好') // 运行完整 ReAct 循环
await session.close()
```

## TUI 界面特性

memo-cli 提供现代化的终端用户界面，包含以下特性：

### 界面布局

- **HeaderBar**：显示会话信息、Provider/Model、当前目录
- **MainContent**：展示对话历史、工具调用、流式输出
- **StatusBar**：实时显示 Token 使用情况、步骤计数
- **InputPrompt**：智能输入框，支持命令补全和历史搜索

### 可视化功能

- **实时流式输出**：助手回答逐字显示，支持打字机效果
- **工具调用卡片**：工具执行状态可视化（pending/executing/success/error）
- **Token 统计**：实时显示 prompt/completion/total token 使用量
- **执行时长**：显示每个 Turn 的处理时间

### 交互设计

- **快捷键支持**：Ctrl+C（中断/退出）、Ctrl+L（清屏）、上下键（历史）
- **Slash 命令**：`/help`、`/exit`、`/clear`、`/tools`、`/config` 等
- **智能补全**：输入时自动提示可用命令和工具
- **历史管理**：保存和检索输入历史

## 内置工具概览

- **文件系统**：`read` / `write` / `edit` / `glob` / `grep`，提供偏移、上下文、全局替换等能力。
- **系统执行**：`bash` 直接运行 Shell；`run_bun` 在沙箱里执行 JS/TS（bubblewrap 或 `sandbox-exec`，可配置网络）。
- **网络获取**：`webfetch` 支持 http/https/data，10 秒超时、512 KB 限制，自动清洗 HTML。
- **辅助工具**：`save_memory`（写入 `~/.memo/memo.md`）、`todo` 管理、`time` 查询。
- **MCP 外部工具**：支持 stdio 或 Streamable HTTP，工具名前会加 `<server>_` 前缀自动注入系统提示词。

详见 `docs/tool/*.md`。

## 快速开始

1. **安装依赖**

    ```bash
    bun install
    ```

2. **配置 API Key**

    ```bash
    export OPENAI_API_KEY=your_key    # 或 DEEPSEEK_API_KEY
    ```

3. **首次运行**

    ```bash
    bun start
    # 将引导填写 provider/model/base_url，并在 ~/.memo/config.toml 保存
    ```

## CLI 使用

memo-cli 支持两种运行模式，根据终端环境自动选择：

### 交互式 TUI 模式（默认）

在支持 TTY 的终端中，自动启动现代化 TUI 界面：

```bash
bun start
```

**TUI 特性**：

- 实时流式输出显示
- 工具调用可视化
- Token 使用统计
- 交互式 Slash 命令
- 输入历史和补全

### 单轮纯文本模式

使用 `--once` 参数或非 TTY 环境时，输出纯文本结果：

```bash
bun start "你的问题" --once
```

**纯文本模式**：

- 简洁的文本输出
- 适合脚本集成
- 便于日志记录
- 保持向后兼容

### 构建与部署

```bash
# 构建 CLI 应用
bun build

# 生成独立二进制文件
bun run build:binary   # 输出 ./memo
```

常用参数：`--once` 控制单轮模式；`--session <id>`（若 UI 已暴露）可恢复历史 session。

## TUI 快捷键与命令

### 快捷键

- **Enter**：提交输入
- **Shift+Enter**：输入换行
- **Up/Down**：浏览输入历史
- **Ctrl+C**：中断当前操作或退出程序
- **Ctrl+L**：清屏

### Slash 命令

- `/help`：显示帮助信息和可用命令
- `/exit`：退出当前会话
- `/clear`：清除屏幕内容
- `/tools`：列出所有可用工具（内置 + MCP）
- `/config`：显示配置文件路径和当前 Provider 信息
- `/memory`：显示记忆文件位置和摘要（如有）

### 输入特性

- **智能补全**：输入时自动提示命令和工具名
- **历史搜索**：支持输入历史检索
- **多行输入**：支持 Shift+Enter 输入多行内容

## 配置详解

`~/.memo/config.toml` 管理 Provider、MCP 与运行选项，`MEMO_HOME` 可以重定向路径。

```toml
current_provider = "deepseek"
max_steps = 100
stream_output = false

[[providers.deepseek]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"
base_url = "https://api.deepseek.com"
```

可通过多个 `[[providers.<name>]]` 段落配置多个 Provider。

MCP 服务器示例：

```toml
[mcp_servers.local_tools]
command = "/path/to/mcp-server"
args = []

[mcp_servers.bing_cn]
type = "streamable_http"
url = "https://mcp.api-inference.modelscope.net/496703c5b3ff47/mcp"
# headers = { Authorization = "Bearer xxx" }
# fallback_to_sse = true  # 默认开启
```

API Key 优先级：`当前 provider 的 env_api_key` > `OPENAI_API_KEY` > `DEEPSEEK_API_KEY`。缺失时 CLI 会提示交互输入并写入配置。

## Session、日志与 Token

- **日志路径**：`~/.memo/sessions/<sanitized-cwd>/<yyyy-mm-dd>_<HHMMss>_<id>.jsonl`。
- **事件类型**：`session_start/turn_start/assistant/action/observation/final/turn_end/session_end`，可回放任意一步。
- **Token 统计**：Prompt & completion 通过 `tiktoken` 估算，并在 UI 中展示本轮预算。
- **Max Steps 防护**：默认 100，可在配置文件调整以避免无限工具循环。

## 项目结构

```
memo-cli/
├── packages/
│   ├── core/          # 配置、Session/Turn 状态机、LLM/工具适配
│   ├── tools/         # 内置工具实现
│   └── ui/            # CLI 入口和 TUI 界面
│       ├── src/
│       │   ├── tui/   # React + Ink TUI 组件
│       │   │   ├── components/  # UI 组件
│       │   │   ├── commands/    # Slash 命令处理
│       │   │   └── utils/       # 工具函数
│       │   └── index.tsx        # CLI 入口点
├── docs/              # 架构、设计、内置工具与未来计划
├── history/           # 运行期生成的 JSONL 示例
├── dist/              # bun build 输出
└── memo               # bun build --compile 生成的可执行文件
```

## 开发脚本

### 基础开发

- `bun install`：安装所有依赖
- `bun start`：启动交互式 TUI
- `bun start "问题" --once`：运行单轮纯文本模式

### 构建与部署

- `bun build`：构建 CLI 应用（产物位于 `dist/`）
- `bun run build:binary`：生成独立二进制文件 `./memo`

### 代码质量

- `bun run format`：使用 Prettier 格式化代码
- `bun run format:check`：检查代码格式

### UI 开发

- 修改 `packages/ui/src/tui/` 下的文件来调整 TUI 界面
- 添加新的 Slash 命令到 `packages/ui/src/tui/commands.ts`
- 自定义组件样式在对应的组件文件中

## 文档索引

### 核心架构

- `docs/core.md`：核心状态机与 Session API
- `docs/multi-turn.md`：多轮策略与会话管理
- `docs/token-counting.md`：token 计费与估算机制

### UI 与设计

- `docs/design/memo-cli-ui-design.md`：TUI 界面设计与实现
- `docs/design/hooks-and-middleware.md`：Hooks 与中间件系统
- `docs/design/gemini-cli.md`：设计参考与灵感

### 工具文档

- `docs/tool/*.md`：各内置工具的详细参数与返回值
- `docs/tool/save_memory.md`：记忆管理工具
- `docs/tool/glob.md`：文件搜索工具

### 未来发展

- `docs/future-plan.md`：项目路线图与计划
- `docs/dev-direction.md`：开发方向与架构演进

## 安全特性

- `run_bun` 依赖 bubblewrap 或 `sandbox-exec`，并可控制网络访问。
- `webfetch`、`bash` 等工具限制超时时间、输出大小与允许路径，降低风险。
- MCP 工具统一通过配置注入，避免在提示词中硬编码密钥。

## 贡献与许可证

- 贡献流程参见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 采用 MIT 许可证。
