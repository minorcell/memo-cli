# memo-cli

终端内的 ReAct Agent，基于 Bun + TypeScript。它附带 Session/Turn 状态机、标准 JSON 协议提示、结构化 JSONL 日志、内置工具编排，并默认对接 DeepSeek（OpenAI 兼容接口）。你可以按需接入任意 OpenAI 兼容 Provider 以及 MCP 工具。

## 预备知识

- 需要 [Bun](https://bun.sh/)（建议 1.1+）和可用的 OpenAI 兼容 API Key。
- 配置、历史日志与缓存写在 `~/.memo/`，设置 `MEMO_HOME` 可以迁移目录。
- 第一次运行会引导生成 `~/.memo/config.toml` 并选择默认 Provider。

## 核心特性

- **Session/Turn 多轮控制**：交互式 REPL + `--once` 单轮模式，支持会话恢复。
- **JSON 协议 ReAct**：强制模型输出 `{"thought":"","action":{...}}` 或 `{"final":""}`，驱动工具调用与回答。
- **结构化日志**：所有事件写入 JSONL（token 计数、工具 observation、LLM 元数据）。
- **Token 预算**：用 `tiktoken` 估算 prompt，结合 LLM usage，对超限做提示或拒绝。
- **内置工具 + MCP 扩展**：提供文件/系统/网络/记忆工具，并自动注入配置的 MCP 工具前缀。

## 架构概览

核心逻辑位于 `packages/core`，UI 只负责交互与输出。

1. **配置层**（`config/`）：读取/写入 `~/.memo/config.toml`，选择 Provider，生成会话路径。
2. **运行时**（`runtime/`）：`session.ts` 执行 ReAct 循环，`history.ts` 写事件，`prompt.ts` 维护 JSON 协议提示。
3. **默认依赖**（`runtime/defaults.ts`）：拼装工具注册表、OpenAI SDK 的 `callLLM`、token counter、`maxSteps` 与日志 sink。
4. **Hooks & Middlewares**：通过 `createAgentSession` 的 `onAssistantStep`、`hooks.onAction`、`onFinal` 等回调订阅生命周期。

```ts
import { createAgentSession } from '@memo/core'

const session = await createAgentSession({ onAssistantStep: console.log })
await session.runTurn('你好') // 运行完整 ReAct 循环
await session.close()
```

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

- **单轮对话**

  ```bash
  bun start "你的问题" --once
  ```

- **交互式多轮**

  ```bash
  bun start
  # 普通输入提问，/exit 退出
  ```

- **构建二进制**

  ```bash
  bun run build:binary   # 输出 ./memo
  ```

常用参数：`--once` 控制单轮；`--session <id>`（若 UI 已暴露）可恢复历史 session。

## 配置详解

`~/.memo/config.toml` 管理 Provider、MCP 与运行选项，`MEMO_HOME` 可以重定向路径。

```toml
current_provider = "deepseek"
max_steps = 100
stream_output = false

[[providers]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"
base_url = "https://api.deepseek.com"
```

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
│   ├── core/      # 配置、Session/Turn 状态机、LLM/工具适配
│   ├── tools/     # 内置工具实现
│   └── ui/        # CLI 入口（REPL、日志输出、交互配置）
├── docs/          # 架构、设计、内置工具与未来计划
├── history/       # 运行期生成的 JSONL 示例
├── dist/          # bun build 输出
└── memo           # bun build --compile 生成的可执行文件
```

## 开发脚本

- `bun install`：安装依赖
- `bun start "问题" --once`：运行 CLI
- `bun build`：构建 CLI（产物位于 `dist/`）
- `bun run build:binary`：输出独立二进制
- `bun run format` / `bun run format:check`：Prettier

## 文档索引

- `docs/core.md`：核心状态机与 Session API
- `docs/design/*.md`：UI、hooks/middleware、未来路线
- `docs/multi-turn.md`：多轮策略
- `docs/token-counting.md`：token 计费与估算
- `docs/tool/*.md`：各工具的参数/返回值

## 安全特性

- `run_bun` 依赖 bubblewrap 或 `sandbox-exec`，并可控制网络访问。
- `webfetch`、`bash` 等工具限制超时时间、输出大小与允许路径，降低风险。
- MCP 工具统一通过配置注入，避免在提示词中硬编码密钥。

## 贡献与许可证

- 贡献流程参见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 采用 MIT 许可证。
