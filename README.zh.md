<div align="center">
  <img src="https://raw.githubusercontent.com/minorcell/memo-code/main/public/logo.svg" width="96" height="96" alt="Memo Code logo">
  <h1>Memo Code</h1>
  <p><strong>面向终端工作流的轻量级编码代理。</strong></p>
  <p>
    <a href="https://memo.mcell.top/">官方网站</a>
    ·
    <a href="https://memo.mcell.top/zh/docs/getting-started/">完整文档</a>
    ·
    <a href="README.md">English</a>
  </p>
  <p>
    <a href="https://github.com/minorcell/memo-code/actions/workflows/test.yml">
      <img src="https://github.com/minorcell/memo-code/actions/workflows/test.yml/badge.svg?branch=main" alt="Test">
    </a>
    <a href="https://codecov.io/gh/minorcell/memo-code">
      <img src="https://codecov.io/gh/minorcell/memo-code/graph/badge.svg" alt="Coverage">
    </a>
    <a href="https://www.npmjs.com/package/@memo-code/memo">
      <img src="https://img.shields.io/npm/v/%40memo-code%2Fmemo" alt="npm version">
    </a>
  </p>
</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/minorcell/memo-code/main/public/demo.png" width="100%" alt="Memo Code 演示图">
</p>

## 🌱 起源

Memo 诞生于一个简单的想法：**我想验证一个最简单的 Agent 是什么样子**。

25年下半年，我在写下技术博客 [Agent = LLM + TOOL](https://stack.mcell.top/blog/2025/26_agent_is_llm_plus_tools) 时，开始思考 Agent 的本质——无非是 LLM + Tool 的循环。但当我真正开始实现时，发现每一个看似简单的功能背后都有大量的工程细节需要处理：

- 系统提示词的最佳实践
- 工具的设计与安全边界
- 多模型切换与兼容性
- 上下文管理（尤其是长会话的压缩策略）
- TUI 难以处理的交互
- 多工作区支持
- npm 包的分发与热更新
- ...

这个项目从一个小 demo 逐渐成长为我现在日常开发中离不开的"效能助手"——它帮我更新文档、管理 GitHub Issues、排查项目问题..., 而我依然使用 Claude Code、Codex CLI 作为主力开发工具，Memo 则是那个默默在后台帮我处理琐事的伙伴。

> 这是一个**个人从 0 构建**的项目，所有架构设计、技术决策都是独立的探索与权衡。如果你对 Agent 的工程实现感兴趣，我希望 Memo 能给你一些参考。

## ✨ 核心特性

| 特性                | 说明                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| **终端 TUI**         | 交互式终端界面：流式渲染 Markdown、思考过程预览、任务计划实时进度     |
| **智能上下文管理**  | 自动压缩长会话上下文，支持配置压缩阈值，基于字节的 token 估算           |
| **会话恢复**        | 恢复历史会话，模型、思考模式、界面状态一并还原                          |
| **Skills 技能系统** | 自动发现项目与用户目录下的 `SKILL.md`、自动去重，内置 skill-creator    |
| **多代理协作**      | 并行子代理独立上下文，拆分大任务并回收结果                              |
| **MCP 深度集成**    | 支持本地/远程 MCP 服务器，OAuth 登录，会话级动态切换                    |
| **内置工具**        | 文件读写检索、命令执行、结构化补丁、网页抓取、MCP 资源浏览              |
| **记忆系统**        | 读取持久化记忆，跨会话保留偏好与项目上下文                              |
| **企业级安全**      | 工具分级审批机制（自动批准/手动批准），支持单次/会话/拒绝三种模式       |
| **OpenAI 兼容**     | 支持任意 OpenAI 兼容 API，灵活配置多 Provider 切换                      |

## 🚀 快速开始

### 1. 安装

```bash
npm install -g @memo-code/memo
# 或 pnpm / yarn / bun
```

### 2. 配置 API Key

```bash
export OPENAI_API_KEY=your_key
# 或配置其他兼容 API
```

### 3. 运行

```bash
memo
```

首次运行会自动引导配置 Provider 和 Model，配置保存至 `~/.memo/config.toml`。

## 📖 使用模式

| 模式       | 命令                                           | 场景                   |
| ---------- | ---------------------------------------------- | ---------------------- |
| 交互模式   | `memo`                                         | 默认，完整 TUI 体验    |
| 单次模式   | `memo --once "prompt"`                         | 执行一次后退出         |
| 继续会话   | `memo --prev`                                  | 加载当前目录的最新会话 |

### CLI 子命令

```bash
memo init               # 为当前项目生成 AGENTS.md
memo mcp list|add|login # 管理 MCP 服务器
memo skills list|read   # 查看与读取 Skills
```

## 🏗️ 架构设计

```
memo-code/
├── packages/
│   ├── core/          # 核心引擎：Session 状态机、LLM/工具循环、内置工具、MCP 客户端、技能
│   └── tui/           # 终端运行时：CLI 入口、交互式 TUI (Ink)
└── site/              # 文档网站（Next.js 静态导出）
```

**技术亮点：**

- **架构**：核心引擎内置工具路由，TUI 薄壳，状态机驱动会话管理
- **测试**：单元 + 集成测试，覆盖率门槛 ≥70%
- **协议**：原生支持 MCP (Model Context Protocol)，可接入任意 MCP 工具服务器
- **Token 估算**：基于字节的实时上下文监控，支持可配置的自动压缩策略
- **分发**：发布至 npm，CI 版本驱动自动发版

## 🔧 内置工具

- `exec_command` / `write_stdin` - 执行 Shell 命令
- `apply_patch` - 结构化补丁编辑（`*** Begin Patch`/`*** End Patch`）
- `read_text_file` / `read_media_file` / `read_files` / `write_file` / `edit_file` / `list_directory` / `search_files` - 文件系统读写与检索
- `webfetch` - 支持分页、Markdown 提取与策略防护的网页抓取
- MCP 资源访问 - `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`
- `update_plan` - 结构化任务进度管理
- `read_skill` - 按需加载技能指令
- `get_memory` - 持久化记忆读取
- Agent 协作 - `spawn_agent` / `send_message` / `followup_task` / `wait_agent` / `interrupt_agent` / `list_agents`

## ⚙️ 配置示例

```toml
current_provider = "openai_compatible"
auto_compact_threshold_percent = 80

[[providers.openai_compatible]]
name = "openai_compatible"
env_api_key = "OPENAI_API_KEY"
model = "gpt-4.1-mini"
base_url = "https://api.openai.com/v1"

# MCP 服务器
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

# Skills（SKILL.md 的绝对路径）
active_skills = ["/path/to/skills/doc-writing/SKILL.md"]
```

---

## 🛠️ 开发指南

```bash
# 安装依赖
pnpm install

# 本地运行
pnpm start

# 构建发布包
pnpm run build

# 测试
pnpm test              # 全部测试
pnpm run test:coverage # 覆盖率报告 (阈值 ≥70%)

# 格式化
pnpm run format        # 写入
pnpm run format:check  # CI 检查
```

## 📄 开源许可

MIT License
