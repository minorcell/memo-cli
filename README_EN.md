# memo-cli

[中文版本](./README.md)

Terminal ReAct agent built with Bun + TypeScript. Supports multi-turn sessions, JSONL logging, built-in tools, and OpenAI-compatible LLMs (DeepSeek by default).

## Highlights

- Multi-turn REPL with `--once` for single-turn exits.
- Tool-driven ReAct: built-in bash/read/write/edit/glob/grep/fetch.
- Structured logs: JSONL per session (token stats + events).
- Token budgeting: local tiktoken estimation + LLM usage reconciliation.

## Quick Start

1. Install deps:
    ```bash
    bun install
    ```
2. Set API key (prefers `OPENAI_API_KEY`, falls back to `DEEPSEEK_API_KEY`):
    ```bash
    export DEEPSEEK_API_KEY=your_key_here
    ```
3. Single-turn run:
    ```bash
    bun start "your question" --once
    ```
4. Interactive REPL (multi-turn):
    ```bash
    bun start
    # type /exit to quit
    ```

### CLI Flags

- `--once`: single-turn then exit (interactive by default).

## Project Structure

- `packages/core`
    - `config/`: constants, config loader (`~/.memo/config.toml`), path helpers.
    - `runtime/`: session/turn runtime (logging, prompt loader, history events, default deps).
    - `llm/`: OpenAI-compatible adapter + tokenizer (DeepSeek by default).
    - `utils/`: parsing helpers.
- `packages/tools`: built-in toolset, exported as `TOOLKIT`.
- `packages/ui`: CLI entry wiring Core + Tools, handles interaction.
- `docs/`: architecture and design notes.

## Scripts

- `bun install` — install deps
- `bun start "question" --once` — run CLI
- `bun run format` / `bun run format:check` — format
- `bun build` — bundle

## Customization

- System prompt: `packages/core/src/runtime/prompt.xml`
- Add tools: implement under `packages/tools/src/tools/` and register in `src/index.ts`.
- Providers/models: configure `~/.memo/config.toml` (`providers` array with name/env_api_key/model/base_url), or override temporarily via `OPENAI_BASE_URL` / `OPENAI_MODEL`.
