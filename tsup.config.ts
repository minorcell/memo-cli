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
    },
    async onSuccess() {
        copyFileSync(join('packages/core/src/prompt/prompt.md'), join('dist/prompt.md'))
        mkdirSync(join('dist/task-prompts'), { recursive: true })
        cpSync(join('packages/tui/src/task-prompts'), join('dist/task-prompts'), {
            recursive: true,
        })
        console.log('✓ Copied prompt.md and task prompts to dist/')
    },
})
