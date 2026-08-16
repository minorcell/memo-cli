import { defineConfig } from 'tsup'
import { copyFileSync, cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const WEBFETCH_EXTERNALS = ['@mozilla/readability', 'ipaddr.js', 'jsdom', 'robots-parser', 'turndown', 'undici']

export default defineConfig({
    entry: {
        index: 'packages/tui/src/cli.tsx',
        'commands/index': 'packages/tui/src/commands/index.tsx',
        'commands/init': 'packages/tui/src/commands/init.tsx',
        'commands/mcp/list': 'packages/tui/src/commands/mcp/list.tsx',
        'commands/mcp/get': 'packages/tui/src/commands/mcp/get.tsx',
        'commands/mcp/add': 'packages/tui/src/commands/mcp/add.tsx',
        'commands/mcp/remove': 'packages/tui/src/commands/mcp/remove.tsx',
        'commands/mcp/login': 'packages/tui/src/commands/mcp/login.tsx',
        'commands/mcp/logout': 'packages/tui/src/commands/mcp/logout.tsx',
        'commands/skills/list': 'packages/tui/src/commands/skills/list.tsx',
        'commands/skills/read': 'packages/tui/src/commands/skills/read.tsx',
    },
    outDir: 'dist',
    format: ['esm'],
    target: 'node22',
    dts: false,
    clean: true,
    minify: true,
    sourcemap: false,
    splitting: false,
    bundle: true,
    external: WEBFETCH_EXTERNALS,
    esbuildOptions(options) {
        options.jsx = 'automatic'
        // CJS dependencies (e.g. the AI SDK toolchain) are inlined into the ESM
        // output; without a require binding their bundled shims throw at import
        // time because "type": "module" files have no require in scope.
        options.banner = {
            js: 'import { createRequire as __memoCreateRequire } from "node:module";const require=__memoCreateRequire(import.meta.url);',
        }
    },
    async onSuccess() {
        copyFileSync(join('packages/core/src/prompt/prompt.md'), join('dist/prompt.md'))
        mkdirSync(join('dist/task-prompts'), { recursive: true })
        cpSync(join('packages/tui/src/task-prompts'), join('dist/task-prompts'), {
            recursive: true,
        })
        mkdirSync(join('dist/skills/builtin'), { recursive: true })
        cpSync(join('packages/core/src/skills/builtin/skill-creator'), join('dist/skills/builtin/skill-creator'), {
            recursive: true,
        })
        console.log('✓ Copied prompt.md, task prompts, and builtin skills to dist/')
    },
})
