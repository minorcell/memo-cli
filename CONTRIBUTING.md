# Contributing

Thanks for your interest in **Memo Code**. Please read these guidelines before opening a PR.

## Getting Started

- Install [Node.js](https://nodejs.org/) (>=22) and [pnpm](https://pnpm.io/). Some tools/tests depend on [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`).
- Install dependencies: `pnpm install`
- Run CLI: `pnpm start "your prompt" --once` or interactive mode with `pnpm start`
- Build output: `pnpm run build`

## Code Style

- Use TypeScript + ESM. Keep current directory/module boundaries (Core/Tools/UI).
- Run formatting before commit: `pnpm run format`; CI uses `pnpm run format:check`.
- Update docs (`README.md`, `docs/`) when changing public interfaces or behavior.

## Testing

- Full tests: `pnpm test`
- Focused test: `pnpm test packages/tools/src/tools/bash.test.ts`
- Add or update relevant tests for new features and ensure local pass before submitting.

## Issue & PR

- Use GitHub issue templates and include reproduction steps, logs, and environment details.
- For feature changes, open an issue first or summarize design decisions in the PR.
- Recommended branch names: `feature/<topic>`, `fix/<topic>`, `docs/<topic>`.
- In PRs, state change scope, risk points, and validation methods; keep commits clean and focused.

## Issue Governance

- New issues are triaged automatically with `needs-triage` and area/type labels.
- Potential duplicates are flagged as `duplicate-candidate`; maintainers should confirm manually.
- Confirmed duplicates should be closed with state reason `duplicate` and linked to the canonical issue.
- Keep one canonical tracking issue per topic; use checklists/sub-issues there instead of parallel duplicates.

## Tips

- Prioritize Core/Tools contracts and reusability; keep UI as a thin wrapper (see `docs/dev-direction.md`).
- For security/filesystem tools, enforce path allowlists and consistent error handling.
- If anything is unclear, open an issue or ask directly in the PR.
