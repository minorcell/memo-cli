# memo-cli

在终端运行的 ReAct Agent，基于 Bun + TypeScript。支持多轮对话（Session/Turn）、JSONL 结构化日志、内置工具调用，默认使用 DeepSeek（OpenAI 兼容接口）。

## 特性

- 多轮对话：交互式 REPL，`--once` 支持单轮退出。
- 工具驱动：内置 bash/read/write/edit/glob/grep/fetch，按 ReAct 协议调用。
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

## 项目结构

- `packages/core`
    - `config/`：常量、配置加载（~/.memo/config.toml）、路径工具。
    - `runtime/`：Session/Turn 运行时（日志、提示词加载、历史事件、默认依赖补全）。
    - `llm/`：模型适配与 tokenizer（OpenAI 兼容 DeepSeek、tiktoken）。
    - `utils/`：解析工具。
- `packages/tools`：内置工具集合，统一导出 `TOOLKIT`。
- `packages/ui`：CLI 入口，组装 Core + Tools 并处理交互。
- `docs/`：架构与设计文档。

## 开发脚本

- 安装依赖：`bun install`
- 运行 CLI：`bun start "问题" --once`
- 格式化：`bun run format` / `bun run format:check`
- 构建：`bun build`

## 定制

- 调整系统提示词：`packages/core/src/runtime/prompt.xml`
- 新增工具：在 `packages/tools/src/tools/` 添加实现并注册到 `src/index.ts`。
- 模型/Provider：在 `~/.memo/config.toml` 配置 `providers`（name/env_api_key/model/base_url），或用 `OPENAI_BASE_URL`、`OPENAI_MODEL` 环境变量临时覆盖。
