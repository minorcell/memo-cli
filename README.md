# memo-cli

一个使用 Bun、DeepSeek 模型和 XML 格式的命令行 Agent（MemoAgent）示例。

## 快速开始

1. 安装依赖：
   ```bash
   bun install
   ```
2. 设置 API 密钥：
   ```bash
   export DEEPSEEK_API_KEY=your_key_here
   ```
3. 运行：
   ```bash
   bun start "你的问题"
   ```

## 项目结构（monorepo）

- `packages/core`：Agent 核心（ReAct 循环、提示词/历史、LLM 客户端、类型）。
- `packages/tools`：内置工具集合（bash/read/write/edit/glob/grep/fetch 等），统一导出 `@memo/tools`。
- `packages/ui`：CLI 入口（后续可替换为 Ink UI），从 `@memo/core`、`@memo/tools` 组装运行。
- `packages/core/prompt.tmpl`：系统提示词模板。

## 自定义

- 修改 `packages/core/prompt.tmpl` 调整行为。
- 在 `packages/tools/src/` 添加新工具或调整现有工具，统一注册于 `@memo/tools`。
- Core 主循环在 `packages/core/src/index.ts`，UI 入口在 `packages/ui/src/index.ts`（使用 Bun 运行）。
