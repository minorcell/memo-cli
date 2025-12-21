import { z } from 'zod'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BUN_INPUT_SCHEMA = z
    .object({
        code: z.string().min(1, 'code cannot be empty'),
    })
    .strict()

type BunInput = z.infer<typeof BUN_INPUT_SCHEMA>

/**
 * 通过将代码写入临时文件并运行来执行任意 Bun (JS/TS) 代码。
 * 这充当了 Agent 的 "Code Interpreter"。
 */
export const runBunTool: McpTool<BunInput> = {
    name: 'run_bun',
    description:
        '在临时文件中运行 Bun (JS/TS) 代码。支持 top-level await。使用 console.log 输出结果。',
    inputSchema: BUN_INPUT_SCHEMA,
    execute: async ({ code }) => {
        const baseTmp = process.env.TMPDIR || tmpdir()
        const runDir = await mkdtemp(join(baseTmp, 'memo-run-bun-'))
        const tmpFilePath = join(runDir, 'main.ts')
        const allowNetwork = process.env.MEMO_RUN_BUN_ALLOW_NET === '1'

        try {
            // 将代码写入临时文件
            await Bun.write(tmpFilePath, code)

            const sandboxEnv = createSandboxEnv(runDir, allowNetwork)
            const sandbox = await resolveSandbox({
                entryFile: tmpFilePath,
                runDir,
                env: sandboxEnv,
                allowNetwork,
            })

            // 启动 Bun 运行文件（在沙箱内）
            const proc = Bun.spawn([sandbox.command, ...sandbox.args], {
                stdout: 'pipe',
                stderr: 'pipe',
                env: sandbox.env,
            })

            const [stdout, stderr] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ])
            const exitCode = await proc.exited

            return textResult(`exit=${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
        } catch (err) {
            return textResult(`run_bun failed: ${(err as Error).message}`, true)
        } finally {
            // 清理：尝试删除临时目录
            try {
                await rm(runDir, { recursive: true, force: true })
            } catch {
                // 忽略清理错误
            }
        }
    },
}

type SandboxContext = {
    entryFile: string
    runDir: string
    env: Record<string, string>
    allowNetwork: boolean
}

type SandboxSpec = {
    command: string
    args: string[]
    env: Record<string, string>
}

const createSandboxEnv = (runDir: string, allowNetwork: boolean): Record<string, string> => {
    const env = sanitizeEnv()
    env.TMPDIR = runDir
    env.HOME = runDir
    env.FORCE_COLOR = '0'
    env.MEMO_RUN_BUN_ALLOW_NET = allowNetwork ? '1' : '0'
    return env
}

const sanitizeEnv = (): Record<string, string> => {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === 'string') {
            env[key] = value
        }
    }
    return env
}

const resolveSandbox = async (context: SandboxContext): Promise<SandboxSpec> => {
    const custom = resolveCustomSandbox(context)
    if (custom) {
        return custom
    }

    if (process.platform === 'linux') {
        return resolveLinuxSandbox(context)
    }

    if (process.platform === 'darwin') {
        return resolveDarwinSandbox(context)
    }

    throw new Error(
        'run_bun sandbox is not configured for this platform. Provide MEMO_RUN_BUN_SANDBOX or use Linux/macOS.',
    )
}

const resolveCustomSandbox = (context: SandboxContext): SandboxSpec | null => {
    const raw = process.env.MEMO_RUN_BUN_SANDBOX
    if (!raw) {
        return null
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new Error('MEMO_RUN_BUN_SANDBOX must be a JSON array of command and args')
    }

    if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        parsed.some((item) => typeof item !== 'string')
    ) {
        throw new Error(
            'MEMO_RUN_BUN_SANDBOX must describe command and args, e.g. ["/usr/bin/env","-i"]',
        )
    }

    const [command, ...args] = parsed as string[]
    const replaced = [command, ...args].map((value) =>
        applySandboxTemplate(value as string, context),
    )

    return {
        command: replaced[0]!,
        args: replaced.slice(1),
        env: context.env,
    }
}

const resolveLinuxSandbox = ({
    entryFile,
    runDir,
    env,
    allowNetwork,
}: SandboxContext): SandboxSpec => {
    const bwrap = Bun.which('bwrap')
    if (!bwrap) {
        throw new Error(
            'run_bun requires bubblewrap (bwrap) on Linux or MEMO_RUN_BUN_SANDBOX for a custom sandbox runner',
        )
    }

    const args = [
        '--die-with-parent',
        '--unshare-user',
        '--unshare-pid',
        '--unshare-uts',
        '--unshare-ipc',
        '--ro-bind',
        '/',
        '/',
        '--bind',
        runDir,
        runDir,
        '--dev-bind',
        '/dev',
        '/dev',
        '--proc',
        '/proc',
        '--tmpfs',
        '/tmp',
        '--chdir',
        runDir,
    ]

    if (!allowNetwork) {
        args.push('--unshare-net')
    }

    args.push('bun', 'run', entryFile)

    return {
        command: bwrap,
        args,
        env,
    }
}

const resolveDarwinSandbox = async ({
    entryFile,
    runDir,
    env,
    allowNetwork,
}: SandboxContext): Promise<SandboxSpec> => {
    const sandboxExec = Bun.which('sandbox-exec')
    if (!sandboxExec) {
        throw new Error(
            'sandbox-exec is required on macOS or specify MEMO_RUN_BUN_SANDBOX for a custom sandbox runner',
        )
    }

    let resolvedDir = runDir
    try {
        resolvedDir = await realpath(runDir)
    } catch {
        // ignore realpath failures
    }

    const escapedDir = escapeForSandboxProfile(resolvedDir)
    const profileParts = [
        '(version 1)',
        '(allow default)',
        '(deny file-write*)',
        `(allow file-write* (subpath "${escapedDir}"))`,
        '(allow file-write* (literal "/dev/null"))',
    ]

    if (!allowNetwork) {
        profileParts.splice(2, 0, '(deny network*)')
    }

    const profile = profileParts.join('\n')

    return {
        command: sandboxExec,
        args: ['-p', profile, 'bun', 'run', entryFile],
        env,
    }
}

const applySandboxTemplate = (value: string, context: SandboxContext): string =>
    value
        .replaceAll('{{entryFile}}', context.entryFile)
        .replaceAll('{{runDir}}', context.runDir)
        .replaceAll('{{allowNetwork}}', context.allowNetwork ? '1' : '0')

const escapeForSandboxProfile = (value: string): string =>
    value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
