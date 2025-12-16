/** @file 配置管理相关的读写与序列化测试。 */
import assert from 'node:assert'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterAll, describe, test, expect } from 'bun:test'
import {
    buildSessionPath,
    loadMemoConfig,
    writeMemoConfig,
    type MCPServerConfig,
} from '@memo/core/config/config'

type HttpServerConfig = Extract<MCPServerConfig, { url: string; type?: 'streamable_http' }>
type SseServerConfig = Extract<MCPServerConfig, { url: string; type: 'sse' }>

function expectHttpServer(
    server: MCPServerConfig | undefined,
    message = 'expected streamable_http server',
): asserts server is HttpServerConfig {
    expect(server).toBeDefined()
    if (!server || !('url' in server) || server.type === 'sse') {
        throw new Error(message)
    }
}

function expectSseServer(
    server: MCPServerConfig | undefined,
    message = 'expected sse server',
): asserts server is SseServerConfig {
    expect(server).toBeDefined()
    if (!server || !('url' in server) || server.type !== 'sse') {
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
    test('embeds sanitized cwd into history path with timestamped filename', async () => {
        const projectDir = join(tempBase, 'My Project:Demo with spaces')
        await mkdir(projectDir, { recursive: true })
        process.chdir(projectDir)

        const path = buildSessionPath('/history-base', 'session123')
        const filename = path.split(/[/\\]/).pop()!
        const dirName = path.split(/[/\\]/).slice(-2, -1)[0]!

        assert.ok(path.startsWith('/history-base'), 'should prefix base dir')
        assert.ok(
            /\d{4}-\d{2}-\d{2}_\d{6}_session123\.jsonl$/.test(filename),
            'filename should contain date/time and session id',
        )
        assert.ok(
            dirName.includes('My-Project-Demo-with-spaces'),
            'cwd part should be sanitized with separators',
        )
    })

    test('truncates overly long path parts to avoid excessive length', async () => {
        const longSegment = 'x'.repeat(150)
        const longDir = join(tempBase, longSegment)
        await mkdir(longDir, { recursive: true })
        const prev = process.cwd()
        process.chdir(longDir)

        const path = buildSessionPath('/history-base', 's')
        const dirName = path.split(/[/\\]/).slice(-2, -1)[0]!
        const segments = dirName.split('-')

        process.chdir(prev)
        assert.ok(dirName.length <= 180, 'directory part should be truncated to max length')
        assert.ok(
            segments.every((p) => p.length > 0 && p.length <= 100),
            'each segment should respect per-part limit',
        )
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
            providers: [
                { name: 'deepseek', env_api_key: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' },
            ],
            mcp_servers: {
                remote: {
                    type: 'streamable_http',
                    url: 'https://example.com/mcp',
                    headers: { Authorization: 'Bearer token', 'X-Trace': '1' },
                    fallback_to_sse: false,
                },
                local: {
                    command: '/bin/echo',
                    args: ['hello'],
                },
            },
        })

        const text = await Bun.file(configPath).text()
        expect(text).toContain('[mcp_servers.remote]')
        expect(text).toContain('type = "streamable_http"')
        expect(text).toContain('url = "https://example.com/mcp"')
        expect(text).toContain('fallback_to_sse = false')
        expect(text).toContain('headers = { "Authorization" = "Bearer token", "X-Trace" = "1" }')
        expect(text).toContain('[mcp_servers.local]')
        expect(text).toContain('command = "/bin/echo"')
        expect(text).toContain('args = ["hello"]')
    })

    test('loadMemoConfig parses http and sse servers with headers', async () => {
        const home = join(tempBase, 'memo-home-load')
        process.env.MEMO_HOME = home
        await mkdir(home, { recursive: true })
        const configText = `
current_provider = "deepseek"
stream_output = false
max_steps = 42

[[providers]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"

[mcp_servers.remote]
type = "streamable_http"
url = "https://example.com/mcp"
headers = { Authorization = "Bearer abc" }
fallback_to_sse = true

[mcp_servers.legacy]
type = "sse"
url = "https://legacy.example.com/mcp"
`
        await Bun.write(join(home, 'config.toml'), configText)

        const loaded = await loadMemoConfig()
        const servers = loaded.config.mcp_servers ?? {}
        const remote = servers.remote
        expectHttpServer(remote)
        expect(remote.type ?? 'streamable_http').toBe('streamable_http')
        expect(remote.url).toBe('https://example.com/mcp')
        expect(remote.headers?.Authorization).toBe('Bearer abc')
        expect(remote.fallback_to_sse).toBe(true)

        const legacy = servers.legacy
        expectSseServer(legacy)
        expect(legacy.url).toBe('https://legacy.example.com/mcp')
    })
})
