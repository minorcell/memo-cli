import { spawn } from 'node:child_process'
import type { ApprovalRequest } from '@memo/core/tools/approval'

const TERMINAL_BELL = '\u0007'
const DESKTOP_NOTIFICATION_TITLE = 'Memo: Approval required'
const DESKTOP_NOTIFICATION_APP_NAME = 'Memo CLI'
const DESKTOP_NOTIFICATION_TIMEOUT_MS = 2000

type NotificationCommand = {
    command: string
    args: string[]
}

export type ApprovalNotificationDeps = {
    platform?: NodeJS.Platform
    writeBell?: (chunk: string) => void
    runCommand?: (command: string, args: string[]) => Promise<void>
}

function normalizeNotificationText(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

function truncateNotificationText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value
    return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function buildNotificationBody(request: ApprovalRequest): string {
    const reason = normalizeNotificationText(request.reason)
    const base = `Tool ${request.toolName} is waiting for your approval.`
    if (!reason) return base
    return truncateNotificationText(`${base} ${reason}`, 220)
}

function escapeAppleScript(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildDesktopNotificationCommand(
    request: ApprovalRequest,
    platform: NodeJS.Platform = process.platform,
): NotificationCommand | null {
    const title = DESKTOP_NOTIFICATION_TITLE
    const body = buildNotificationBody(request)

    if (platform === 'darwin') {
        return {
            command: 'osascript',
            args: ['-e', `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`],
        }
    }

    if (platform === 'linux') {
        return {
            command: 'notify-send',
            args: ['--app-name', DESKTOP_NOTIFICATION_APP_NAME, title, body],
        }
    }

    return null
}

async function runNotificationCommand(command: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const proc = spawn(command, args, { stdio: 'ignore' })
        let settled = false

        const finalize = (error?: Error) => {
            if (settled) return
            settled = true
            if (error) {
                reject(error)
                return
            }
            resolve()
        }

        const timer = setTimeout(() => {
            try {
                proc.kill()
            } catch {
                // Ignore kill failures.
            }
            finalize()
        }, DESKTOP_NOTIFICATION_TIMEOUT_MS)

        proc.once('error', (error) => {
            clearTimeout(timer)
            finalize(error)
        })

        proc.once('exit', (code) => {
            clearTimeout(timer)
            if (code === 0 || code === null) {
                finalize()
                return
            }
            finalize(new Error(`${command} exited with code ${code}`))
        })
    })
}

function playTerminalBell(writeBell?: (chunk: string) => void): void {
    if (writeBell) {
        writeBell(TERMINAL_BELL)
        return
    }

    try {
        if (process.stdout?.isTTY) {
            process.stdout.write(TERMINAL_BELL)
            return
        }
        if (process.stderr?.isTTY) {
            process.stderr.write(TERMINAL_BELL)
        }
    } catch {
        // Ignore bell output failures.
    }
}

export async function notifyApprovalRequested(
    request: ApprovalRequest,
    deps: ApprovalNotificationDeps = {},
): Promise<void> {
    playTerminalBell(deps.writeBell)

    const command = buildDesktopNotificationCommand(request, deps.platform ?? process.platform)
    if (!command) return

    const runCommand = deps.runCommand ?? runNotificationCommand
    try {
        await runCommand(command.command, command.args)
    } catch {
        // Desktop notification is best-effort and must never block approval UX.
    }
}
