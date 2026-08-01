# @memo/core Overview

Core provides the central capabilities of **Memo Code**: the ReAct loop, session state management, default dependency wiring (LLM/tools/prompt/history), config loading, and shared types/utilities. The design goal is "thick Core, thin UI": UI handles interaction and callbacks, while Core owns behavior.

## Directory Layout

- `config/`
    - `config.ts`: Reads `~/.memo/config.toml` (providers, sessions path), handles provider selection, session path building, and config writes.
- `llm/`
    - `ai_provider.ts`: AI SDK provider factory registry (dispatch by provider name; openai-compatible default).
    - `ai_stream.ts`: Default streaming LLM call via AI SDK `streamText`.
    - `model_profile.ts`: Model capability resolution (parallel tool calls, reasoning, context window).
- `agent/` — the agent loop kernel (minimal, readable, replaceable)
    - `loop.ts`: ReAct loop (observe → think → act → record), session state, token usage, permissions, abort handling.
    - `messages.ts`: Message construction and LLM result normalization (AI SDK `ModelMessage`/`GenerateTextResult`).
    - `sdk_tools.ts`: Adapter from the memo Tool registry to AI SDK tools — execute wrappers run approval (white-list → classifier → fingerprint), truncation, and deny handling inside `streamText`.
    - `step_gate.ts`: Per-step concurrency gate (serializes mutating tools, skips pending tools after denial).
    - `session.ts`: `createAgentSession` factory.
    - `defaults.ts`: Composition root — default dependency completion (toolset, LLM, prompt, history sink, tokenizer).
    - `hooks.ts`: Hook/middleware runners and history snapshotting.
    - `compact_prompt.ts`: Context compaction prompt building.
- `tools/` — tool registry, approval, and the 24 built-in tools (merged back from the former tools package)
    - `router/`: ToolRouter (native + MCP registries); MCP clients via `@ai-sdk/mcp` (`router/mcp/pool.ts`), disk cache and OAuth credentials kept.
    - `approval/`: Approval manager (risk classifier, fingerprints, once/session/deny caches).
    - `tools/`: Built-in tool implementations (`defineMcpTool` zod adapter).
- `features/` — user-facing capabilities built on the contracts (not part of the loop); one directory per module, exports via `index.ts`
    - `slash/`: Slash command specs and registry.
    - `file_suggestions/`: File suggestion helpers for the composer.
    - `history/`: Complete session-history module — JSONL sink (write side, injected by the composition root), parser and index (read side for resume/viewing).
- `prompt/`
    - `prompt.ts` + `prompt.md`: System prompt loading (runtime context, AGENTS.md/SOUL.md/skills injection).
- `skills/` / `mcp/`
    - Skill management and MCP server admin.
- `types.ts`: Shared types (`AgentDeps`, `Session/Turn`, `LanguageModelUsage`, `HistoryEvent`, etc.).
- `utils/`
    - Utility functions (assistant output parsing, message wrappers).
    - `tokenizer.ts`: tiktoken-based tokenizer helpers.
- `index.ts`: Package entry, exports core modules and types.

## Key Flows

- `createAgentSession(deps, options)`: Creates a Session, fills default dependencies, loads prompt, and returns an object with `runTurn`.
- `withDefaultDeps`: Injects default toolset, LLM client, prompt, history sink (writes to `~/.memo/sessions/YY/MM/DD/<uuid>.jsonl`), and tokenizer based on config and overrides.
- Session history: JSONL events (`session_start/turn_start/assistant/action/observation/final/turn_end/session_end`) with metadata like provider, model, tokenizer, and token usage.
- Config: `~/.memo/config.toml` (overridable via `MEMO_HOME`). If missing, UI setup flow is triggered.

## Usage Example

```ts
import { createAgentSession } from '@memo/core'

const session = await createAgentSession({ onAssistantStep: console.log }, { mode: 'interactive' })
const turn = await session.runTurn('Hello')
await session.close()
```

If you provide custom tool/LLM/prompt/sink dependencies, override the related fields in `deps/options`. Defaults select the current provider and write sessions in the user directory.
