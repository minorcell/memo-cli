/** @file 配置管理相关的读写与序列化测试。 */
import assert from 'node:assert'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterAll, describe, test, expect } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import {
    buildSessionPath,
    getSessionsDir,
    loadMemoConfig,
    resolveContextWindowForProvider,
    writeMemoConfig,
    type MCPServerConfig,
} from '@memo/core/config/config'

type HttpServerConfig = Extract<MCPServerConfig, { url: string; type?: 'streamable_http' }>

function expectHttpServer(
    server: MCPServerConfig | undefined,
    message = 'expected streamable_http server',
): asserts server is HttpServerConfig {
    expect(server).toBeDefined()
    if (!server || !('url' in server)) {
        throw new Error(message)
    }
}

let originalCwd: string
let tempBase: string
let originalMemoHome: string | undefined

beforeAll(async () => {
    originalCwd = process.cwd()
    tempBase = join(tmpdir(), 'memo-core-config-test')
    await mkdir(tempBase, { recursive: true })
    originalMemoHome = process.env.MEMO_HOME
})

afterAll(async () => {
    process.chdir(originalCwd)
    if (originalMemoHome === undefined) {
        delete process.env.MEMO_HOME
    } else {
        process.env.MEMO_HOME = originalMemoHome
    }
})

describe('buildSessionPath', () => {
    test('uses date-uuid filename under project-specific sessions directory', async () => {
        const projectDir = join(tempBase, 'My Project:Demo with spaces')
        await mkdir(projectDir, { recursive: true })
        process.chdir(projectDir)

        const path = buildSessionPath('/history-base', 'session123')
        const segments = path.split(/[/\\]/).filter(Boolean)
        const filename = segments[segments.length - 1] ?? ''

        assert.ok(path.startsWith('/history-base'), 'should prefix base dir')
        assert.ok(
            /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-session123\.jsonl$/.test(filename),
            'filename should be datetime-sessionId.jsonl',
        )
    })

    test('encodes cwd into one flat project directory name', async () => {
        const longSegment = 'x'.repeat(150)
        const longDir = join(tempBase, `workspace-${longSegment}`)
        await mkdir(join(longDir, longSegment), { recursive: true })
        const prev = process.cwd()
        process.chdir(join(longDir, longSegment))

        const sessionsDir = getSessionsDir(
            {
                config: {
                    current_provider: 'deepseek',
                    providers: [
                        {
                            name: 'deepseek',
                            env_api_key: 'DEEPSEEK_API_KEY',
                            model: 'deepseek-chat',
                        },
                    ],
                    mcp_servers: {},
                },
                home: '/tmp/.memo',
                configPath: '/tmp/.memo/config.toml',
                needsSetup: false,
            },
            {},
        )
        process.chdir(prev)
        assert.ok(sessionsDir.startsWith('/tmp/.memo/sessions'), 'should stay under sessions base dir')
        const projectDirName = sessionsDir.split('/').at(-1) ?? ''
        assert.ok(projectDirName.startsWith('-'), 'encoded project directory should start with "-"')
        assert.ok(projectDirName.includes(longSegment), 'sessions dir should include cwd path segments')
        assert.ok(!sessionsDir.includes(`/${longSegment}/`), 'cwd segments should be flattened into one directory name')
    })
})

describe('mcp config serialization', () => {
    test('writeMemoConfig outputs stdio and http server fields', async () => {
        const home = join(tempBase, 'memo-home-write')
        process.env.MEMO_HOME = home
        const configPath = join(home, 'config.toml')
        await mkdir(home, { recursive: true })

        await writeMemoConfig(configPath, {
            current_provider: 'deepseek',
            active_mcp_servers: ['remote'],
            active_skills: ['/tmp/.memo/skills/doc-writing/SKILL.md'],
            mcp_oauth_credentials_store_mode: 'file',
            mcp_oauth_callback_port: 8765,
            model_profiles: {
                'gpt-5': {
                    supports_parallel_tool_calls: true,
                    context_window: 272000,
                },
                'openai:gpt-5': {
                    context_window: 128000,
                },
            },
            providers: [{ name: 'deepseek', env_api_key: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' }],
            mcp_servers: {
                remote: {
                    type: 'streamable_http',
                    url: 'https://example.com/mcp',
                    headers: { Authorization: 'Bearer token', 'X-Trace': '1' },
                    bearer_token_env_var: 'MCP_TOKEN',
                },
                local: {
                    command: '/bin/echo',
                    args: ['hello'],
                    env: { FOO: 'bar' },
                },
            },
        })

        const text = await readFile(configPath, 'utf-8')
        expect(text).toContain('[[providers.deepseek]]')
        expect(text).toContain('active_mcp_servers = ["remote"]')
        expect(text).toContain('active_skills = ["/tmp/.memo/skills/doc-writing/SKILL.md"]')
        expect(text).toContain('mcp_oauth_credentials_store_mode = "file"')
        expect(text).toContain('mcp_oauth_callback_port = 8765')
        expect(text).toContain('auto_compact_threshold_percent = 90')
        expect(text).toContain('[model_profiles.gpt-5]')
        expect(text).toContain('supports_parallel_tool_calls = true')
        expect(text).toContain('context_window = 272000')
        expect(text).toContain('[model_profiles."openai:gpt-5"]')
        expect(text).toContain('context_window = 128000')
        expect(text).toContain('[mcp_servers.remote]')
        expect(text).toContain('type = "streamable_http"')
        expect(text).toContain('url = "https://example.com/mcp"')
        expect(text).toContain('bearer_token_env_var = "MCP_TOKEN"')
        expect(text).toContain('headers = { "Authorization" = "Bearer token", "X-Trace" = "1" }')
        expect(text).toContain('[mcp_servers.local]')
        expect(text).toContain('command = "/bin/echo"')
        expect(text).toContain('args = ["hello"]')
        expect(text).toContain('[mcp_servers.local.env]')
        expect(text).toContain('"FOO" = "bar"')
    })

    test('loadMemoConfig keeps explicit empty active_mcp_servers selection', async () => {
        const home = join(tempBase, 'memo-home-empty-active')
        process.env.MEMO_HOME = home
        await mkdir(home, { recursive: true })
        const configText = `
current_provider = "deepseek"
active_mcp_servers = []

[[providers.deepseek]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"

[mcp_servers.remote]
url = "https://example.com/mcp"
`
        await writeFile(join(home, 'config.toml'), configText, 'utf-8')

        const loaded = await loadMemoConfig()
        expect(loaded.config.active_mcp_servers).toEqual([])
    })

    test('writeMemoConfig persists custom auto_compact_threshold_percent', async () => {
        const home = join(tempBase, 'memo-home-write-auto-compact-threshold')
        process.env.MEMO_HOME = home
        const configPath = join(home, 'config.toml')
        await mkdir(home, { recursive: true })

        await writeMemoConfig(configPath, {
            current_provider: 'deepseek',
            auto_compact_threshold_percent: 70,
            providers: [{ name: 'deepseek', env_api_key: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' }],
            mcp_servers: {},
        })

        const text = await readFile(configPath, 'utf-8')
        expect(text).toContain('auto_compact_threshold_percent = 70')
    })

    test('loadMemoConfig parses streamable_http servers with headers', async () => {
        const home = join(tempBase, 'memo-home-load')
        process.env.MEMO_HOME = home
        await mkdir(home, { recursive: true })
        const configText = `
current_provider = "deepseek"
active_mcp_servers = ["remote2"]
active_skills = ["/tmp/.memo/skills/doc-writing/SKILL.md"]
mcp_oauth_credentials_store_mode = "keyring"
mcp_oauth_callback_port = 12345

[model_profiles.gpt-5]
supports_parallel_tool_calls = true
supports_reasoning_content = true
context_window = 272000

[[providers.deepseek]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"

[mcp_servers.remote]
type = "streamable_http"
url = "https://example.com/mcp"
headers = { Authorization = "Bearer abc" }

[mcp_servers.remote2]
url = "https://example.com/mcp-2"
`
        await writeFile(join(home, 'config.toml'), configText, 'utf-8')

        const loaded = await loadMemoConfig()
        const servers = loaded.config.mcp_servers ?? {}
        expect(loaded.config.active_mcp_servers).toEqual(['remote2'])
        expect(loaded.config.active_skills).toEqual(['/tmp/.memo/skills/doc-writing/SKILL.md'])
        expect(loaded.config.mcp_oauth_credentials_store_mode).toBe('keyring')
        expect(loaded.config.mcp_oauth_callback_port).toBe(12345)
        expect(loaded.config.model_profiles?.['gpt-5']).toEqual({
            supports_parallel_tool_calls: true,
            supports_reasoning_content: true,
            context_window: 272000,
        })
        const remote = servers.remote
        expectHttpServer(remote)
        expect(remote.type ?? 'streamable_http').toBe('streamable_http')
        expect(remote.url).toBe('https://example.com/mcp')
        expect(remote.headers?.Authorization).toBe('Bearer abc')
        const remote2 = servers.remote2
        expectHttpServer(remote2)
        expect(remote2.type ?? 'streamable_http').toBe('streamable_http')
        expect(remote2.url).toBe('https://example.com/mcp-2')
    })

    test('loadMemoConfig ignores legacy providers array', async () => {
        const home = join(tempBase, 'memo-home-legacy')
        process.env.MEMO_HOME = home
        await mkdir(home, { recursive: true })
        const configText = `
current_provider = "legacy"

[[providers]]
name = "legacy"
env_api_key = "LEGACY_API_KEY"
model = "legacy-model"
`
        await writeFile(join(home, 'config.toml'), configText, 'utf-8')

        const loaded = await loadMemoConfig()
        expect(loaded.needsSetup).toBe(true)
        expect(loaded.config.current_provider).not.toBe('legacy')
    })

    test('loadMemoConfig falls back to defaults when context_window is not configured', async () => {
        const home = join(tempBase, 'memo-home-missing-limit')
        process.env.MEMO_HOME = home
        await mkdir(home, { recursive: true })
        const configText = `
current_provider = "deepseek"

[[providers.deepseek]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"
`
        await writeFile(join(home, 'config.toml'), configText, 'utf-8')

        const loaded = await loadMemoConfig()
        expect(loaded.config.mcp_oauth_credentials_store_mode).toBe('auto')
        expect(loaded.config.auto_compact_threshold_percent).toBe(90)
    })

    test('loadMemoConfig reads custom auto_compact_threshold_percent', async () => {
        const home = join(tempBase, 'memo-home-custom-auto-compact-threshold')
        process.env.MEMO_HOME = home
        await mkdir(home, { recursive: true })
        const configText = `
current_provider = "deepseek"
auto_compact_threshold_percent = 65

[[providers.deepseek]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"
`
        await writeFile(join(home, 'config.toml'), configText, 'utf-8')

        const loaded = await loadMemoConfig()
        expect(loaded.config.auto_compact_threshold_percent).toBe(65)
    })

    test('loadMemoConfig falls back to default when auto_compact_threshold_percent is invalid', async () => {
        const home = join(tempBase, 'memo-home-invalid-auto-compact-threshold')
        process.env.MEMO_HOME = home
        await mkdir(home, { recursive: true })
        const configText = `
current_provider = "deepseek"
auto_compact_threshold_percent = 150

[[providers.deepseek]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"
`
        await writeFile(join(home, 'config.toml'), configText, 'utf-8')

        const loaded = await loadMemoConfig()
        expect(loaded.config.auto_compact_threshold_percent).toBe(90)
    })

    test('loadMemoConfig ignores legacy max_prompt_tokens', async () => {
        const home = join(tempBase, 'memo-home-legacy-max-prompt-tokens')
        process.env.MEMO_HOME = home
        await mkdir(home, { recursive: true })
        const configText = `
current_provider = "deepseek"
max_prompt_tokens = 150000

[[providers.deepseek]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"
`
        await writeFile(join(home, 'config.toml'), configText, 'utf-8')

        const loaded = await loadMemoConfig()
        expect('max_prompt_tokens' in loaded.config).toBe(false)
    })

    test('loadMemoConfig ignores invalid model_profiles entries', async () => {
        const home = join(tempBase, 'memo-home-invalid-model-profiles')
        process.env.MEMO_HOME = home
        await mkdir(home, { recursive: true })
        const configText = `
current_provider = "deepseek"

[[providers.deepseek]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"

[model_profiles.gpt-5]
context_window = "invalid"
supports_parallel_tool_calls = "yes"
`
        await writeFile(join(home, 'config.toml'), configText, 'utf-8')

        const loaded = await loadMemoConfig()
        expect(loaded.config.model_profiles).toBeUndefined()
    })
})

describe('resolveContextWindowForProvider', () => {
    test('uses provider:model override before model override', () => {
        const contextWindow = resolveContextWindowForProvider(
            {
                model_profiles: {
                    'gpt-5': { context_window: 272000 },
                    'openai:gpt-5': { context_window: 128000 },
                },
            },
            { name: 'openai', model: 'gpt-5', env_api_key: 'OPENAI_API_KEY' },
        )

        expect(contextWindow).toBe(128000)
    })

    test('uses model override when provider:model override is missing', () => {
        const contextWindow = resolveContextWindowForProvider(
            {
                model_profiles: {
                    'gpt-5': { context_window: 272000 },
                },
            },
            { name: 'openai', model: 'gpt-5', env_api_key: 'OPENAI_API_KEY' },
        )

        expect(contextWindow).toBe(272000)
    })

    test('falls back to default when context_window is not configured', () => {
        const contextWindow = resolveContextWindowForProvider(
            {
                model_profiles: {
                    'gpt-5': { supports_parallel_tool_calls: true },
                },
            },
            { name: 'openai', model: 'gpt-5', env_api_key: 'OPENAI_API_KEY' },
        )

        expect(contextWindow).toBe(1_000_000)
    })

    test('matches keys case-insensitively and trims surrounding spaces', () => {
        const contextWindow = resolveContextWindowForProvider(
            {
                model_profiles: {
                    ' GPT-5 ': { context_window: 180000 },
                    ' OpenAI:GPT-5 ': { context_window: 128000 },
                },
            },
            { name: '  OpenAI ', model: ' gpt-5 ', env_api_key: 'OPENAI_API_KEY' },
        )

        expect(contextWindow).toBe(128000)
    })

    test('falls back from invalid provider override to valid model override', () => {
        const contextWindow = resolveContextWindowForProvider(
            {
                model_profiles: {
                    'openai:gpt-5': { context_window: -1 },
                    'gpt-5': { context_window: 200000 },
                },
            },
            { name: 'openai', model: 'gpt-5', env_api_key: 'OPENAI_API_KEY' },
        )

        expect(contextWindow).toBe(200000)
    })
})
