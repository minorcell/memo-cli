import { spawn } from 'node:child_process'
import type { MCPServerConfig } from '@memo/core'

const GH_COMMAND_TIMEOUT_MS = 12_000
const GH_REVIEW_PERMISSIONS = new Set(['WRITE', 'MAINTAIN', 'ADMIN'])
const GITHUB_MCP_TOOL_SUFFIXES = [
    'pull_request_read',
    'list_pull_requests',
    'search_pull_requests',
    'add_issue_comment',
    'add_comment_to_pending_review',
    'issue_read',
    'get_me',
] as const

export type ReviewBackendSelection =
    | {
          kind: 'github_mcp'
          strategy: 'github_mcp'
          details: string
          mcpServerPrefix: string
      }
    | {
          kind: 'gh_cli'
          strategy: 'gh_cli'
          details: string
          repository: string
          viewerPermission: string
      }
    | {
          kind: 'unavailable'
          reason: string
      }

type CommandProbe = {
    ok: boolean
    stdout: string
    stderr: string
    code: number | null
    errorMessage?: string
}

type GhProbeSuccess = {
    ok: true
    repository: string
    viewerPermission: string
}

type GhProbeFailure = {
    ok: false
    reason: string
}

type GhProbeResult = GhProbeSuccess | GhProbeFailure

function normalizeCommand(command: string): string {
    return command.replace(/\\/g, '/').toLowerCase()
}

export function isGitHubMcpServer(name: string, config: MCPServerConfig): boolean {
    const serverName = name.toLowerCase()
    if (serverName.includes('github')) return true

    if ('command' in config) {
        const command = normalizeCommand(config.command)
        const args = (config.args ?? []).join(' ').toLowerCase()
        if (command.includes('github') || command.includes('gh-')) return true
        if (args.includes('github') || args.includes('gh-')) return true
        return false
    }

    const url = config.url.toLowerCase()
    return url.includes('github') || url.includes('api.github.com')
}

export function findActiveGitHubMcpServer(
    mcpServers: Record<string, MCPServerConfig>,
    activeServerNames: string[],
): { active: string | null; inactiveCandidates: string[] } {
    const activeSet = new Set(activeServerNames)
    const candidates = Object.entries(mcpServers)
        .filter(([name, config]) => isGitHubMcpServer(name, config))
        .map(([name]) => name)

    const activeCandidate = candidates.find((name) => activeSet.has(name)) ?? null
    const inactiveCandidates = candidates.filter((name) => !activeSet.has(name))
    return { active: activeCandidate, inactiveCandidates }
}

export function detectGitHubMcpToolPrefixes(toolNames: string[]): string[] {
    const scoreByPrefix = new Map<string, number>()

    for (const toolName of toolNames) {
        for (const suffix of GITHUB_MCP_TOOL_SUFFIXES) {
            const marker = `_${suffix}`
            if (!toolName.endsWith(marker)) continue
            const prefix = toolName.slice(0, -marker.length)
            if (!prefix) continue
            scoreByPrefix.set(prefix, (scoreByPrefix.get(prefix) ?? 0) + 1)
        }
    }

    return Array.from(scoreByPrefix.entries())
        .filter(([, score]) => score >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([prefix]) => prefix)
}

async function runCommand(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs = GH_COMMAND_TIMEOUT_MS,
): Promise<CommandProbe> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        let stdout = ''
        let stderr = ''
        let settled = false

        const finish = (result: CommandProbe) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            resolve(result)
        }

        const timeout = setTimeout(() => {
            child.kill('SIGTERM')
            finish({
                ok: false,
                stdout,
                stderr,
                code: null,
                errorMessage: `${command} ${args.join(' ')} timed out after ${timeoutMs}ms`,
            })
        }, timeoutMs)

        child.stdout.on('data', (chunk: Buffer | string) => {
            stdout += chunk.toString()
        })

        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr += chunk.toString()
        })

        child.on('error', (error) => {
            finish({
                ok: false,
                stdout,
                stderr,
                code: null,
                errorMessage: error.message,
            })
        })

        child.on('close', (code) => {
            finish({
                ok: code === 0,
                stdout,
                stderr,
                code,
            })
        })
    })
}

async function probeGhCli(cwd: string): Promise<GhProbeResult> {
    const version = await runCommand('gh', ['--version'], cwd)
    if (!version.ok) {
        return {
            ok: false,
            reason: 'GitHub MCP not available, and GitHub CLI (gh) is not installed or not executable. Install gh: https://cli.github.com/',
        }
    }

    const auth = await runCommand('gh', ['auth', 'status', '-h', 'github.com'], cwd)
    if (!auth.ok) {
        const detail = auth.stderr.trim() || auth.stdout.trim() || auth.errorMessage || 'unknown error'
        return {
            ok: false,
            reason: `GitHub CLI is installed but not authenticated for github.com. Run: gh auth login -h github.com (detail: ${detail})`,
        }
    }

    const repoView = await runCommand('gh', ['repo', 'view', '--json', 'nameWithOwner,viewerPermission'], cwd)
    if (!repoView.ok) {
        const detail = repoView.stderr.trim() || repoView.stdout.trim() || repoView.errorMessage || 'unknown error'
        return {
            ok: false,
            reason: `GitHub CLI authentication works, but this directory is not a readable GitHub repo for gh (detail: ${detail})`,
        }
    }

    let parsed: { nameWithOwner?: string; viewerPermission?: string }
    try {
        parsed = JSON.parse(repoView.stdout)
    } catch {
        return {
            ok: false,
            reason: 'Failed to parse `gh repo view` output. Try upgrading gh and retry.',
        }
    }

    const repository = parsed.nameWithOwner?.trim()
    const viewerPermission = parsed.viewerPermission?.trim().toUpperCase()

    if (!repository || !viewerPermission) {
        return {
            ok: false,
            reason: 'GitHub CLI did not return repository or permission info from `gh repo view`.',
        }
    }

    if (!GH_REVIEW_PERMISSIONS.has(viewerPermission)) {
        return {
            ok: false,
            reason: `GitHub CLI connected to ${repository}, but permission is ${viewerPermission}. PR review comments require WRITE/MAINTAIN/ADMIN permission.`,
        }
    }

    return {
        ok: true,
        repository,
        viewerPermission,
    }
}

export async function resolveReviewBackend(options: {
    cwd: string
    mcpServers: Record<string, MCPServerConfig>
    activeMcpServerNames: string[]
    availableToolNames?: string[]
}): Promise<ReviewBackendSelection> {
    const gitHubToolPrefixes = detectGitHubMcpToolPrefixes(options.availableToolNames ?? [])
    const activeGitHubToolPrefix =
        options.activeMcpServerNames.find((name) => gitHubToolPrefixes.includes(name)) ?? null

    const hasServerToolPrefix = (serverName: string): boolean => {
        const toolNames = options.availableToolNames
        if (!toolNames || toolNames.length === 0) return true
        const prefix = `${serverName}_`
        return toolNames.some((name) => name.startsWith(prefix))
    }

    if (activeGitHubToolPrefix && hasServerToolPrefix(activeGitHubToolPrefix)) {
        return {
            kind: 'github_mcp',
            strategy: 'github_mcp',
            details: `Using active GitHub MCP server \`${activeGitHubToolPrefix}\` (detected from loaded MCP tool signatures).`,
            mcpServerPrefix: activeGitHubToolPrefix,
        }
    }

    const { active, inactiveCandidates } = findActiveGitHubMcpServer(options.mcpServers, options.activeMcpServerNames)

    if (active && hasServerToolPrefix(active)) {
        return {
            kind: 'github_mcp',
            strategy: 'github_mcp',
            details: `Using active GitHub MCP server \`${active}\`.`,
            mcpServerPrefix: active,
        }
    }

    const ghProbe = await probeGhCli(options.cwd)
    if (ghProbe.ok) {
        const fallbackNote = inactiveCandidates.length
            ? ` GitHub MCP server(s) configured but inactive in this session: ${inactiveCandidates.join(', ')}.`
            : ''
        return {
            kind: 'gh_cli',
            strategy: 'gh_cli',
            details: `Using gh CLI on repo \`${ghProbe.repository}\` with permission \`${ghProbe.viewerPermission}\`.${fallbackNote}`,
            repository: ghProbe.repository,
            viewerPermission: ghProbe.viewerPermission,
        }
    }

    const inactiveHint = inactiveCandidates.length
        ? ` Also found configured but inactive GitHub MCP server(s): ${inactiveCandidates.join(', ')}. Start a new session and activate one of them, or fix gh CLI access.`
        : ''
    const missingToolHint =
        active && !hasServerToolPrefix(active)
            ? ` Active MCP server \`${active}\` is configured, but no tools with prefix \`${active}_\` are currently loaded in this session.`
            : ''

    return {
        kind: 'unavailable',
        reason: `${ghProbe.reason}${missingToolHint}${inactiveHint}`,
    }
}
