import type { ApprovalRequest } from '@memo/core/tools/approval'
import { describe, expect, test, vi } from 'vitest'
import { buildDesktopNotificationCommand, notifyApprovalRequested } from './approvalNotification'

const REQUEST: ApprovalRequest = {
    toolName: 'exec_command',
    params: { cmd: 'echo test' },
    fingerprint: 'approval-1',
    reason: 'Tool "exec_command" requires approval.',
}

describe('buildDesktopNotificationCommand', () => {
    test('builds darwin notification command', () => {
        const command = buildDesktopNotificationCommand(REQUEST, 'darwin')
        expect(command).not.toBeNull()
        expect(command?.command).toBe('osascript')
        expect(command?.args[0]).toBe('-e')
        expect(command?.args[1]).toContain('display notification')
        expect(command?.args[1]).toContain('Memo: Approval required')
        expect(command?.args[1]).toContain('exec_command')
    })

    test('builds linux notification command', () => {
        const command = buildDesktopNotificationCommand(REQUEST, 'linux')
        expect(command).toEqual({
            command: 'notify-send',
            args: [
                '--app-name',
                'Memo CLI',
                'Memo: Approval required',
                'Tool exec_command is waiting for your approval. Tool "exec_command" requires approval.',
            ],
        })
    })

    test('returns null on unsupported platform', () => {
        expect(buildDesktopNotificationCommand(REQUEST, 'win32')).toBeNull()
    })
})

describe('notifyApprovalRequested', () => {
    test('rings bell and runs desktop notification command', async () => {
        const writeBell = vi.fn()
        const runCommand = vi.fn(async () => {})

        await notifyApprovalRequested(REQUEST, {
            platform: 'linux',
            writeBell,
            runCommand,
        })

        expect(writeBell).toHaveBeenCalledWith('\u0007')
        expect(runCommand).toHaveBeenCalledTimes(1)
        expect(runCommand.mock.calls[0]?.[0]).toBe('notify-send')
    })

    test('still rings bell when desktop notification fails', async () => {
        const writeBell = vi.fn()
        const runCommand = vi.fn(async () => {
            throw new Error('failed')
        })

        await expect(
            notifyApprovalRequested(REQUEST, {
                platform: 'linux',
                writeBell,
                runCommand,
            }),
        ).resolves.toBeUndefined()

        expect(writeBell).toHaveBeenCalledWith('\u0007')
        expect(runCommand).toHaveBeenCalledTimes(1)
    })

    test('rings bell without desktop notification on unsupported platform', async () => {
        const writeBell = vi.fn()
        const runCommand = vi.fn(async () => {})

        await notifyApprovalRequested(REQUEST, {
            platform: 'win32',
            writeBell,
            runCommand,
        })

        expect(writeBell).toHaveBeenCalledWith('\u0007')
        expect(runCommand).not.toHaveBeenCalled()
    })
})
