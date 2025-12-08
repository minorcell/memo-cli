# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指导。

## 项目概述

使用 Bun 构建的终端 ReAct Agent，monorepo 结构。支持多轮对话、JSONL 事件日志、默认工具集，LLM 通过 OpenAI 兼容接口（默认 DeepSeek），配置与会话日志放在 `~/.memo`。

## 包结构（简版）

- `packages/core`: 核心 ReAct 循环、会话状态、默认依赖装配
    - `runtime/`: Session/Turn、事件、提示词加载、默认依赖注入
    - `config/`: `~/.memo/config.toml` 读取（providers、max_steps、sessions 路径）
    - `llm/`: OpenAI SDK 适配（DeepSeek 默认）、tokenizer
    - `utils/`: 解析工具
    - `types.ts`: 公共类型（AgentDeps/Session 等）
- `packages/tools`: 内置工具（bash/read/write/edit/glob/grep/fetch），导出 `TOOLKIT`
- `packages/ui`: 简易 CLI（REPL + `--once`），主要做 I/O 与回调订阅
- `docs/`: 架构、配置、设计说明

## 配置与日志

- 配置文件：`~/.memo/config.toml`（current_provider、providers 列表、max_steps 等）
- 会话日志：JSONL，按日期分桶 `~/.memo/sessions/YY/MM/DD/<uuid>.jsonl`
- Provider 不存 API key，只存环境变量名；默认 DeepSeek（env: `DEEPSEEK_API_KEY`）

## 工作流提示

- 默认依赖由 Core 自动补齐（工具集、LLM、prompt、历史 sink、tokenizer）；UI 只传回调。
- `MAX_STEPS` 由配置 `max_steps` 控制（默认 100）；每个 turn 内步数限制。
- CLI 解析 `--once`，交互式引导缺省 provider 配置写入 `config.toml`。

## 开发命令（保持不变）

```bash
bun install
bun start "question" --once
bun build
bun run format
```

## 开发命令

```bash
# 安装依赖
bun install

# 本地运行（需要 DEEPSEEK_API_KEY 或 OPENAI_API_KEY）
bun start "你的问题"

# 构建分发版本（输出到 dist/）
bun build

# 格式化代码
bun run format          # 写入更改
bun run format:check    # 仅检查

# 直接调试（绕过 package.json 脚本）
bun run packages/ui/src/index.ts "问题"
```

## 环境配置

- **必需**: `DEEPSEEK_API_KEY`（或使用 `OPENAI_API_KEY` 作为后备）
- **可选**:
    - `OPENAI_BASE_URL`（默认: `https://api.deepseek.com`）
    - `OPENAI_MODEL`（默认: `deepseek-chat`）
- 生成的 `history.xml` 文件包含完整对话日志，如涉及敏感信息不应提交。

## 代码风格

- 尽可能的使用`bun`的api，而不是`node`
- TypeScript + ESM 模块
- 4 空格缩进，无分号，禁用单引号（见 `prettier.config.mjs`）
- 变量/函数使用 camelCase，类型/类使用 PascalCase，共享常量使用 CONSTANT_CASE
- 保持 `packages/core` 中的函数小巧纯粹；副作用应放在 UI/tools 层
- 从包入口点使用显式命名导出

## 添加新工具

1. 在 `packages/tools/src/tools/your_tool.ts` 创建新文件
2. 导出符合 `ToolFn` 类型签名的函数：`(input: string) => Promise<string>`
3. 在 `packages/tools/src/index.ts` 的 TOOLKIT 记录中注册该工具
4. 更新 `packages/core/src/prompt.xml` 中的系统提示词以描述工具用法

## 重要实现细节

- **历史格式**: 对话以 XML 格式记录，使用 `<message role="...">` 标签，保存到根目录的 `history.xml`
- **工具执行**: 当前每个 assistant 轮次仅支持单个工具调用（从 `<action><tool>name</tool><input>...</input></action>` 解析）
- **解析逻辑**: `packages/core/src/utils.ts` 中的 `parseAssistant()` 从 LLM 响应中提取 `<action>` 或 `<final>` 块
- **安全机制**: `MAX_STEPS = 100` 防止无限循环；若循环退出时未生成 final 则返回兜底回答
- **LLM 温度**: 在 `packages/core/src/llm/openai.ts` 中设置为 0.35，平衡创造性和一致性
