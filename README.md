# memo-cli

在终端运行的 ReAct Agent，基于 Bun + TypeScript。支持多轮对话（Session/Turn）、JSONL 结构化日志、内置工具调用，默认使用 DeepSeek（OpenAI 兼容接口）。

## 特性

- 多轮对话：交互式 REPL，`--once` 支持单轮退出。
- 工具驱动：内置 bash/run_bun/read/write/edit/glob/grep/webfetch（HTML 自动转纯文本）、save_memory、todo，按 ReAct 协议调用。
- 结构化日志：默认写入 `history/<sessionId>.jsonl`，可携带 token 计数与事件。
- 可配置 token 预算：本地 tiktoken 预估 + LLM usage 对账，支持提示超限预警/拒绝。

## 快速开始

1. 安装依赖
    ```bash
    bun install
    ```
2. 配置 API Key（优先 OPENAI_API_KEY，回退 DEEPSEEK_API_KEY）
    ```bash
    export DEEPSEEK_API_KEY=your_key_here
    ```
3. 启动一次性对话
    ```bash
    bun start "你的问题" --once
    ```
4. 进入交互式 REPL（多轮）
    ```bash
    bun start
    # 输入 /exit 退出
    ```

### CLI 参数

- `--once`：单轮对话后退出（默认交互式多轮）。

### 工具说明

- **run_bun**：代码解释器工具，可以在临时文件中运行任意 Bun (JS/TS) 代码，支持 top-level await，使用 `console.log` 输出结果。
- **webfetch**：网页抓取工具，支持 http/https/data 协议，具有 10 秒超时和 512KB 大小限制，能自动将 HTML 转换为纯文本。
- 更多工具详情请查看 `docs/tool/` 目录下的文档。

## 外部 MCP Server

- 配置文件：`~/.memo/config.toml`（可用 `MEMO_HOME` 覆盖）。在 `[mcp_servers.<name>]` 下添加条目。
- 本地 stdio 服务器（已有可执行文件）：  
  ```toml
  [mcp_servers.local_tools]
  command = "/path/to/mcp-server"
  args = []
  ```
- 远程 HTTP 服务器（Streamable HTTP，失败会自动回退 SSE）：  
  ```toml
  [mcp_servers.bing_cn]
  type = "streamable_http"
  url = "https://mcp.api-inference.modelscope.net/496703c5b3ff47/mcp"
  # 可选：headers = { Authorization = "Bearer xxx" }
  # 可选：fallback_to_sse = true   # 默认开启
  ```
- 保存配置后重启 memo，会在系统提示词中注入外部工具列表（工具名前会带 `<server>_` 前缀）。

## 项目结构

- `packages/core`
    - `config/`：常量、配置加载（~/.memo/config.toml）、路径工具。
    - `runtime/`：Session/Turn 运行时（日志、提示词加载、历史事件、默认依赖补全）。
    - `llm/`：模型适配与 tokenizer（OpenAI 兼容 DeepSeek、tiktoken）。
    - `utils/`：解析工具。
- `packages/tools`：内置工具集合，统一导出 `TOOLKIT`。
- `packages/ui`：CLI 入口，组装 Core + Tools 并处理交互。
- `docs/`：架构与设计文档。
    - `tool/`：每个工具的详细使用说明。

## 开发脚本

- 安装依赖：`bun install`
- 运行 CLI：`bun start "问题" --once`
- 格式化：`bun run format` / `bun run format:check`
- 构建：`bun build`
- 构建二进制文件：`bun run build:binary`
