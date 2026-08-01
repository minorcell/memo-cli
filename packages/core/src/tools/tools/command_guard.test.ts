import assert from 'node:assert'
import { describe, test } from 'vitest'
import { detectDangerousCommand, guardDangerousCommand } from '@memo/core/tools/tools/command_guard'

describe('command guard', () => {
    test('detects dangerous delete and disk mutation commands', () => {
        const blockedCommands = [
            'rm -rf /',
            'sudo rm -r -- /',
            'rm -rf ~',
            'rm -rf /*',
            'mkfs.ext4 /dev/sda',
            'dd if=/dev/zero of=/dev/sda bs=1M',
            'cat payload > /dev/nvme0n1',
            'wipefs -a /dev/sda',
        ]

        for (const command of blockedCommands) {
            const match = detectDangerousCommand(command)
            assert.ok(match, `expected dangerous command to be detected: ${command}`)
        }
    })

    test('allows scoped commands that should remain usable', () => {
        const safeCommands = [
            'rm -rf ./tmp',
            'rm -r /tmp/demo',
            'echo "rm -rf /"',
            'dd if=/dev/zero of=./disk.img bs=1M count=1',
            'cat payload > /tmp/dev/sda',
        ]

        for (const command of safeCommands) {
            const match = detectDangerousCommand(command)
            assert.strictEqual(match, null, `expected command to be allowed: ${command}`)
        }
    })

    test('returns xml system hint when blocked', () => {
        const result = guardDangerousCommand({
            toolName: 'exec_command',
            command: 'rm -rf /',
        })
        assert.strictEqual(result.blocked, true)
        if (!result.blocked) return

        assert.ok(result.xml.startsWith('<system_hint '))
        assert.ok(result.xml.includes('reason="dangerous_command"'))
        assert.ok(result.xml.includes('tool="exec_command"'))
        assert.ok(result.xml.includes('rule="rm_recursive_critical_target"'))
    })
})
