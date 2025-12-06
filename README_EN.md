# memo-cli

[中文版本](./README.md)

A ReAct Agent built with Bun that runs in the terminal.

## Quick Start

1. Install dependencies:
    ```bash
    bun install
    ```
2. Set API key:
    ```bash
    export DEEPSEEK_API_KEY=your_key_here
    ```
3. Run:
    ```bash
    bun start "your question"
    ```

## Project Structure (monorepo)

- `packages/core`: Agent core (ReAct loop, prompt/history, LLM client, types).
- `packages/tools`: Built-in toolset (bash/read/write/edit/glob/grep/fetch, etc.), exported as `@memo/tools`.
- `packages/ui`: CLI entry (can be replaced with Ink UI later), assembles and runs from `@memo/core`, `@memo/tools`.
- `packages/core/prompt.tmpl`: System prompt template.

## Customization

- Modify `packages/core/prompt.tmpl` to adjust behavior.
- Add new tools or adjust existing ones in `packages/tools/src/`, all registered in `@memo/tools`.
- Core main loop is in `packages/core/src/index.ts`, UI entry is in `packages/ui/src/index.ts` (run with Bun).
