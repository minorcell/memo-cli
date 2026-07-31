import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['src/index.ts'],
    outDir: 'dist',
    format: ['esm', 'cjs'],
    target: 'node22',
    dts: true,
    clean: true,
    sourcemap: false,
    minify: false,
    splitting: false,
    bundle: true,
    external: [
        '@dqbd/tiktoken',
        '@mozilla/readability',
        'ipaddr.js',
        'jsdom',
        'robots-parser',
        'turndown',
        'undici',
        'ai',
        '@ai-sdk/openai-compatible',
    ],
})
