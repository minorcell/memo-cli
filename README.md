<div align="center">
  <img src="https://raw.githubusercontent.com/minorcell/memo-code/main/public/logo.svg" width="96" height="96" alt="Memo Code logo">
  <h1>Memo Code</h1>
  <p><strong>A lightweight coding agent for terminal workflows.</strong></p>
  <p>
    <a href="https://memo.mcell.top/">Website</a>
    ·
    <a href="https://memo.mcell.top/zh/docs/getting-started/">Documentation</a>
    ·
    <a href="README.zh.md">中文文档</a>
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
  <img src="https://raw.githubusercontent.com/minorcell/memo-code/main/public/demo.png" width="100%" alt="Memo Code demo">
</p>

---

## 🌱 Origin

Memo started with a simple question: **What does the simplest Agent look like?**

In the second half of 2024, while writing my tech blog post [Agent = LLM + TOOL](https://stack.mcell.top/blog/2025/26_agent_is_llm_plus_tools), I began thinking about the essence of Agents — nothing more than LLM + Tool loops. But when I actually started implementing it, I discovered that behind every seemingly simple feature lies a mountain of engineering details:

- Best practices for system prompts
- Tool design and security boundaries
- Multi-model switching and compatibility
- Context management (especially long-session compaction strategies)
- Tricky TUI interactions
- Multi-workspace support
- npm package distribution and hot-reloading
- ...

This project grew from a small demo into an indispensable "productivity assistant" in my daily development — it helps me update documentation, manage GitHub Issues, debug projects... While I still use Claude Code and Codex CLI as my primary development tools, Memo quietly handles the tedious tasks in the background.

> This is a **personal project built from scratch**. All architectural designs and technical decisions are independent explorations and trade-offs. If you're interested in the engineering implementation of Agents, I hope Memo can give you some reference.

---

## ✨ Features

| Feature                       | Description                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Terminal TUI**             | Interactive terminal UI with streaming markdown, thinking previews, and live plan progress            |
| **Smart Context Management**  | Auto-compact long session context, configurable threshold, byte-based token estimation                |
| **Session Resume**            | Resume past sessions with model, thinking mode, and UI state restored                                 |
| **Skills System**             | Auto-discover `SKILL.md` across project and user roots, dedup, built-in skill-creator                 |
| **Deep MCP Integration**      | Local/remote MCP servers, OAuth login, per-session dynamic switching                                  |
| **Enterprise-Grade Security** | Tool approval system (auto-approve/manual-approve), supports once/session/deny modes                  |
| **OpenAI Compatible**         | Works with any OpenAI-compatible API, flexible multi-Provider configuration                           |

---

## 🚀 Quick Start

### 1. Install

```bash
npm install -g @memo-code/memo
# or pnpm / yarn / bun
```

### 2. Configure API Key

```bash
export OPENAI_API_KEY=your_key
# or configure other compatible APIs
```

### 3. Run

```bash
memo
```

First run will guide you through Provider/Model setup and save config to `~/.memo/config.toml`.

---

## 📖 Usage Modes

| Mode           | Command                                        | Scenario                                  |
| -------------- | ---------------------------------------------- | ----------------------------------------- |
| Interactive    | `memo`                                         | Default, full TUI experience              |
| One-shot       | `memo --once "prompt"`                         | Run once and exit                         |
| Resume Session | `memo --prev`                                  | Load latest session for current directory |

### CLI Subcommands

```bash
memo init               # generate AGENTS.md for the current project
memo mcp list|add|login # manage MCP servers
memo skills list|read   # discover and read skills
```

---

## 🏗️ Architecture

```
memo-code/
├── packages/
│   ├── core/          # Agent engine: session state machine, LLM/tool loop, built-in tools, MCP client, skills
│   └── tui/           # Terminal runtime: CLI entry, interactive TUI (Ink)
└── site/              # Documentation website (Next.js, static export)
```

**Technical Highlights:**

- **Architecture**: Core engine with integrated tool routing, thin TUI on top, state-machine driven session management
- **Testing**: Unit + integration tests, coverage threshold ≥70%
- **Protocol**: Native MCP (Model Context Protocol) support, can integrate any MCP tool server
- **Token Estimation**: Real-time context monitoring with byte-based estimation, configurable auto-compaction strategy
- **Distribution**: Published to npm with version-driven auto releases via CI

---

## 🔧 Built-in Tools

- `exec_command` / `write_stdin` - Execute Shell commands
- `apply_patch` - Structured patch editing (`*** Begin Patch`/`*** End Patch`)
- `read_text_file` / `read_media_file` / `read_files` / `write_file` / `edit_file` / `list_directory` / `search_files` - Filesystem read/write/search
- `webfetch` - Paged web fetching with markdown extraction and policy guards
- MCP resource access - `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`
- `update_plan` - Structured task progress management
- `read_skill` - Load skill instructions on demand
- `get_memory` - Persistent memory reading
- Agent collaboration - `spawn_agent` / `send_message` / `followup_task` / `wait_agent` / `interrupt_agent` / `list_agents`

---

## ⚙️ Config Example

```toml
current_provider = "openai_compatible"
auto_compact_threshold_percent = 80

[[providers.openai_compatible]]
name = "openai_compatible"
env_api_key = "OPENAI_API_KEY"
model = "gpt-4.1-mini"
base_url = "https://api.openai.com/v1"

# MCP Server
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

# Skills (absolute paths to SKILL.md files)
active_skills = ["/path/to/skills/doc-writing/SKILL.md"]
```

---

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Run locally
pnpm start

# Build for distribution
pnpm run build

# Test
pnpm test              # all tests
pnpm run test:coverage # coverage report (threshold ≥70%)

# Format
pnpm run format        # write
pnpm run format:check  # CI check
```

---

## Contributors

![Contributors](https://hub-io-mcells-projects.vercel.app/r/minorcell/memo-code?bots=1)

## 📄 License

MIT License
