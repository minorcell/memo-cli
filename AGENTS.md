# Repository Guidelines

## Project Structure & Module Organization

- Monorepo managed by Bun workspaces; core TypeScript lives under `packages/*`.
- `packages/core`: ReAct loop, prompt loader (`src/prompt.xml`), history writer (`src/history.ts`), shared types/utils.
- `packages/tools`: Built-in tools registered for the agent; extend by adding files in `packages/tools/src/tools/` and exporting via `src/index.ts`.
- `packages/ui`: CLI entrypoint; stitches core and tools for terminal usage.
- `dist`: Bundled output from `bun build`; keep source-of-truth in `packages/*`.
- `docs`/`public`: Project docs and static assets; `history.xml` in repo root is generated chat history.

## Build, Test, and Development Commands

- Install deps: `bun install`.
- Run locally: `bun start "你的问题"` (runs `packages/ui/src/index.ts` via Bun; requires API key set).
- Bundle for distribution: `bun build` (outputs Bun-targeted build to `dist/`; script includes `--minify` by default).
- Direct entry for debugging: `bun run packages/ui/src/index.ts "question"` to bypass scripts.
- Format code: `bun run format` (write) or `bun run format:check` (verify).

## Coding Style & Naming Conventions

- TypeScript + ESM modules; prefer explicit named exports from package entrypoints.
- Use camelCase for variables/functions, PascalCase for types/interfaces/classes, and CONSTANT_CASE for shared constants (e.g., `MAX_STEPS`).
- Keep functions small and pure in `packages/core`; side effects live in UI/tools layers.
- Prettier config lives in `prettier.config.mjs` (4-space indent, no semicolons); use the provided format scripts. Keep comments concise (bilingual style in codebase).

## Testing Guidelines

- No automated test suite is configured yet; add new tests alongside features as `*.test.ts` near the source directory and wire them to `bun test` when introduced.
- For now, validate changes by running `bun start` with representative prompts and confirming `history.xml` captures the conversation as expected.
- Prefer deterministic fixtures for tool behaviors (e.g., mock file reads/writes) when adding tests to avoid external side effects.

## Commit & Pull Request Guidelines

- Git history follows a light Conventional Commit style (`refactor: ...`, `fix: ...`, `docs: ...`); match this for new commits.
- In PRs, include: purpose, notable commands run, sample CLI output (or screenshots if adding UI), and any new env/config requirements.
- Link related issues/tasks and call out breaking changes or tool additions so downstream consumers can adjust quickly.

## Security & Configuration Tips

- Requires `DEEPSEEK_API_KEY` in the environment; do not commit keys or captured transcripts containing secrets.
- Generated `history.xml` may include user prompts and model outputs—treat it as sensitive and avoid checking it in.
- When adding tools that touch the filesystem or network, keep inputs validated and log outputs minimal to reduce leaking context.
