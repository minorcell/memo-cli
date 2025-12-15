# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指导。

## 项目概述

memo-cli 是基于 Bun + TypeScript 的终端 ReAct Agent（monorepo 结构，~2000 行核心代码）。支持多轮对话、JSONL 日志、9 个内置工具，通过 OpenAI 兼容接口调用 LLM（默认 DeepSeek），配置存储在 `~/.memo`。

## 包结构

- **packages/core** (~1000 行)：ReAct 循环、会话状态、配置管理
    - `runtime/session.ts`：状态机主逻辑
    - `runtime/defaults.ts`：依赖注入（自动装配工具/LLM/tokenizer）
    - `runtime/history.ts`：JSONL 事件日志
    - `runtime/prompt.md`：系统提示词模板
    - `config/config.ts`：`~/.memo/config.toml` 管理
    - `utils/utils.ts`：JSON 输出解析（提取 action/final）
    - `utils/tokenizer.ts`：Token 计数（tiktoken）

- **packages/tools** (~700 行)：9 个工具（bash/read/write/edit/glob/grep/webfetch/save_memory/todo）
    - 基于 MCP 协议，Zod 验证输入
    - 统一导出为 `TOOLKIT`

- **packages/ui** (~170 行)：CLI 交互层（REPL + `--once` 模式）

- **docs/**：架构文档（core.md、config-storage.md、tools/\*.md）

## 核心机制

### ReAct 循环（JSON 协议）

LLM 输出格式：

```json
{"thought": "推理过程", "action": {"tool": "bash", "input": {"command": "ls"}}}
{"final": "最终回答"}
```

**流程**（session.ts:163-299）：

1. 用户输入 → 加入历史
2. 调用 LLM → 解析 JSON（parseAssistant）
3. 有 `action` → 执行工具 → observation 回写 → 继续循环
4. 有 `final` → 结束并返回
5. 保护：max_steps（默认 100）防无限循环

**错误恢复**：未知工具/执行失败 → 返回错误信息，引导模型重试

### LLM 集成

**配置**（config.toml）：

```toml
current_provider = "deepseek"
max_steps = 100
stream_output = true

[[providers]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"  # 仅存环境变量名
model = "deepseek-chat"
base_url = "https://api.deepseek.com"
```

**调用**：OpenAI SDK，temperature=0.35，默认开启流式输出

### 工具系统

| 工具        | 功能            | 特性                   |
| ----------- | --------------- | ---------------------- |
| bash        | 执行 shell 命令 | 捕获 stdout/stderr     |
| read        | 读取文件        | 支持 offset/limit 分页 |
| write       | 写入文件        | 自动创建父目录         |
| edit        | 字符串替换      | 支持 replace_all       |
| glob        | 文件匹配        | 基于 Bun.Glob          |
| grep        | 文本搜索        | 基于 ripgrep           |
| webfetch    | HTTP GET        | 10s 超时，512KB 限制   |
| save_memory | 长期记忆        | 追加到 ~/.memo/memo.md |
| todo        | 待办清单        | 进程内，最多 10 条     |

## 配置与日志

```
~/.memo/
├── config.toml              # 全局配置
├── sessions/                # 按工作目录分桶
│   └── <cwd>/
│       └── 2025-12-12_153045_<uuid>.jsonl
└── memo.md                  # 长期记忆（save_memory 写入）
```

**JSONL 事件**：session_start、turn_start、assistant、action、observation、final、turn_end、session_end
**元数据**：timestamp、provider、model、token usage、elapsed_ms

## 开发命令

```bash
bun install                        # 安装依赖
bun start "问题"                   # 交互式 REPL
bun start "问题" --once            # 单轮模式
bun build                          # 构建到 dist/
bun run build:binary               # 编译可执行文件（./memo，60MB）
bun run format                     # 代码格式化
bun run format:check               # 检查格式

# 调试
bun run packages/ui/src/index.ts "问题"
```

**环境变量**：

- 必需：`DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`
- 可选：`OPENAI_BASE_URL`、`OPENAI_MODEL`

## 代码风格

- 优先使用 Bun API（非 Node.js）
- TypeScript + ESM，4 空格缩进，无分号，单引号
- 命名：camelCase（变量/函数）、PascalCase（类型）、CONSTANT_CASE（常量）
- Core 保持纯函数，副作用放 UI/tools 层

## 添加新工具

1. 创建 `packages/tools/src/tools/your_tool.ts`：

```typescript
import { z } from 'zod'
import type { McpTool } from '../types'

const inputSchema = z.object({ param: z.string() })

export const yourTool: McpTool<z.infer<typeof inputSchema>> = {
    name: 'your_tool',
    description: '描述',
    inputSchema,
    execute: async (input) => ({
        content: [{ type: 'text', text: '结果' }],
        isError: false,
    }),
}
```

2. 在 `packages/tools/src/index.ts` 注册到 `TOOLKIT`

3. 更新 `packages/core/src/runtime/prompt.md` 描述用法

## 重要细节

- **历史格式**：JSONL，位于 `~/.memo/sessions/<cwd>/<timestamp>.jsonl`
- **工具调用**：每轮仅支持单个工具（从 JSON 解析 action）
- **安全机制**：max_steps 限制、配置不存密钥、日志放用户目录
- **Token 管理**：tiktoken 本地估算 + LLM usage 统计
- **依赖注入**：UI 只传回调，Core 自动装配（defaults.ts:withDefaultDeps）
- **长期记忆**：save_memory 写入 memo.md，下次启动自动注入系统提示词
- **错误处理**：工具失败不中断，返回错误信息引导模型重试

## 执行流程

```
main() → parseArgs() → ensureProviderConfig()
  → createAgentSession() → withDefaultDeps() → new AgentSessionImpl()
  → session.runTurn(input)
      [循环] callLLM() → parseAssistant() → 执行工具 → 回写 observation
  → 返回 TurnResult
  → session.close()
```

## 关键文件

- `packages/ui/src/index.ts` - 入口
- `packages/core/src/runtime/session.ts` - ReAct 核心
- `packages/core/src/utils/utils.ts` - JSON 解析
- `packages/core/src/config/config.ts` - 配置管理
- `packages/tools/src/index.ts` - 工具注册
- `packages/core/src/runtime/prompt.md` - 系统提示词
- `docs/core.md` - 架构文档

## 设计亮点

- **依赖注入**：UI 只传回调，Core 自动装配
- **按 cwd 分桶**：会话日志按工作目录分组
- **安全设计**：配置仅存环境变量名，日志不入版本控制
- **双轨 Token 统计**：本地估算 + LLM usage
- **流式输出**：实时显示推理过程
- **MCP 协议**：标准化工具接口，易扩展
- **错误自愈**：工具失败引导模型重试

## 已知限制

- 每轮仅单个工具调用（无并行）
- todo 工具进程内存储（重启清空）
- webfetch 10s 超时 + 512KB 限制
- 会话不支持跨进程恢复
