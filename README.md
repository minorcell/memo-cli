# memo-cli

终端内的 ReAct Agent，基于 Bun + TypeScript。它附带 Session/Turn 状态机、标准 JSON 协议提示、结构化 JSONL 日志、内置工具编排，并默认对接 DeepSeek（OpenAI 兼容接口）。你可以按需接入任意 OpenAI 兼容 Provider 以及 MCP 工具。

**全新 TUI 界面**：提供现代化的终端用户界面，支持实时流式输出、工具调用可视化、token 使用统计和交互式命令。

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
url = "https://mcp.api-inference.modelscope.net/xxxxxxxx/mcp"
# headers = { Authorization = "Bearer xxx" }
# fallback_to_sse = true  # 默认开启
```

API Key 优先级：`当前 provider 的 env_api_key` > `OPENAI_API_KEY` > `DEEPSEEK_API_KEY`。缺失时 CLI 会提示交互输入并写入配置。

## Session、日志与 Token

- **日志路径**：`~/.memo/sessions/<sanitized-cwd>/<yyyy-mm-dd>_<HHMMss>_<id>.jsonl`。
- **事件类型**：`session_start/turn_start/assistant/action/observation/final/turn_end/session_end`，可回放任意一步。
- **Token 统计**：Prompt & completion 通过 `tiktoken` 估算，并在 UI 中展示本轮预算。
- **Max Steps 防护**：默认 100，可在配置文件调整以避免无限工具循环。

## 贡献与许可证

- 贡献流程参见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 采用 MIT 许可证，详见 [LICENSE](LICENSE)。
