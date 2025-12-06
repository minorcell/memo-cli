# memo-cli

[中文版本](./README.md)

A Bun + TypeScript ReAct agent for the terminal. Supports multi-turn sessions, JSONL logs, built-in tools, and token budgeting (DeepSeek by default via OpenAI-compatible API).

## Highlights

- Multi-turn REPL with `--once` for single-turn exits.
- Tool-driven ReAct: built-in bash/read/write/edit/glob/grep/fetch.
- Structured logs: JSONL per session under `history/<sessionId>.jsonl` with token stats and events.
- Token budget controls: local tiktoken estimation + LLM usage reconciliation; configurable warnings/hard limits.

## Quick Start

1. Install dependencies:
    ```bash
    bun install
    ```
2. Set API key (prefers `OPENAI_API_KEY`, falls back to `DEEPSEEK_API_KEY`):
    ```bash
    export DEEPSEEK_API_KEY=your_key_here
    ```
3. Single-turn run:
    ```bash
    bun start "your question"
    ```
4. Interactive REPL (multi-turn):
    ```bash
    bun start
    # type /exit to quit
    ```

### CLI Flags

- `--once`: single-turn then exit (interactive by default).

## Project Structure (monorepo)

- `packages/core`
  - `config/`: constants.
  - `runtime/`: session/turn runtime, prompt loader, history events.
  - `llm/`: model adapter (DeepSeek via OpenAI) and tokenizer helper.
  - `utils/`: parsing and request helpers.
- `packages/tools`: Built-in toolset, exported as `TOOLKIT`.
- `packages/ui`: CLI entry wiring Core + Tools, handles interaction.
- `docs/`: architecture and design notes.

## Customization

- Tweak system prompt: `packages/core/src/runtime/prompt.xml`.
- Add tools: implement under `packages/tools/src/tools/` and register in `packages/tools/src/index.ts`.
- Change model/params: set `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY`/`DEEPSEEK_API_KEY`.
