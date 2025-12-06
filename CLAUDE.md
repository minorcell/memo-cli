# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指导。

## 项目概述

使用 Bun 构建的终端 ReAct Agent，采用 Bun workspaces 管理的 monorepo 结构。Agent 遵循 ReAct（推理与行动）循环模式，LLM 基于工具观察结果生成思考、行动和最终回答。

## 核心架构

### 包结构

- **`packages/core`**: Agent 核心逻辑，实现 ReAct 循环
  - `src/index.ts`: 主函数 `runAgent()`，包含 MAX_STEPS 安全限制
  - `src/prompt.xml`: 系统提示词模板（以文本形式导入）
  - `src/prompt.ts`: 加载系统提示词模板
  - `src/history.ts`: 将对话日志写入根目录的 `history.xml`（XML 格式）
  - `src/llm/openai.ts`: OpenAI 兼容 API 客户端（默认使用 DeepSeek）
  - `src/utils.ts`: 消息包装和 assistant 响应解析工具函数
  - `src/types.ts`: 共享 TypeScript 接口（AgentDeps、ChatMessage 等）

- **`packages/tools`**: 内置工具实现
  - `src/tools/`: 各工具实现文件（bash、read、write、edit、glob、grep、fetch）
  - `src/index.ts`: 导出 TOOLKIT 对象，将工具名称映射到函数
  - 通过在 `src/tools/` 创建文件并在 `src/index.ts` 注册来添加新工具

- **`packages/ui`**: CLI 入口点
  - `src/index.ts`: 整合 core 和 tools，处理控制台输出，运行 agent

### 关键设计模式

- **依赖注入**: `runAgent()` 函数接受包含 tools、LLM 调用器、提示词加载器和历史写入器的 `AgentDeps` 对象。便于定制和测试。
- **ReAct 循环**: 系统最多迭代 MAX_STEPS 次，执行：调用 LLM → 解析响应 → 执行工具 → 将观察结果作为 user 消息反馈，直到生成 `<final>` 答案。
- **Workspace 导入**: 根目录 `package.json` 定义了 `@memo/core` 和 `@memo/tools` 导入路径，实现跨包引用而无需相对路径。

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
