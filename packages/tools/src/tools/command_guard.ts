import { posix as pathPosix } from 'node:path'

const MAX_COMMAND_PREVIEW = 220
const MAX_STDIN_BUFFER = 4096

type GuardContext = {
    toolName: string
    command: string
    sessionId?: number
}

export type DangerousCommandMatch = {
    ruleId: string
    matchedSegment: string
}

export type CommandGuardResult = { blocked: false } | { blocked: true; xml: string; match: DangerousCommandMatch }

const BLOCK_DEVICE_PATH_REGEX =
    /^\/dev\/(?:sd[a-z]\d*|vd[a-z]\d*|xvd[a-z]\d*|hd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|mmcblk\d+(?:p\d+)?|disk\d+|rdisk\d+)$/i

const REDIRECT_TO_DEVICE_REGEX =
    /(?:^|[\s(])(?:\d?>>?|>>|>\||&>)\s*\/dev\/(?:sd[a-z]\d*|vd[a-z]\d*|xvd[a-z]\d*|hd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|mmcblk\d+(?:p\d+)?|disk\d+|rdisk\d+)(?:\s|$)/i

const SUDO_FLAGS_WITH_VALUE = new Set([
    '-u',
    '--user',
    '-g',
    '--group',
    '-h',
    '--host',
    '-p',
    '--prompt',
    '-C',
    '-T',
    '-r',
    '--role',
    '-t',
    '--type',
    '-D',
    '--chdir',
])

const DISK_MUTATION_TOOLS = new Set([
    'fdisk',
    'sfdisk',
    'cfdisk',
    'parted',
    'sgdisk',
    'gdisk',
    'wipefs',
    'blkdiscard',
    'shred',
])

type ParsedSegment = {
    raw: string
    commandName: string
    args: string[]
}

function escapeXmlAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function previewCommand(command: string): string {
    const compact = command.replace(/\s+/g, ' ').trim()
    return compact.length > MAX_COMMAND_PREVIEW ? `${compact.slice(0, MAX_COMMAND_PREVIEW)}…` : compact
}

function normalizeCommandName(token: string): string {
    const trimmed = token.trim().replace(/^['"]|['"]$/g, '')
    const parts = trimmed.split(/[\\/]/)
    const base = parts.at(-1) ?? trimmed
    return base.toLowerCase()
}

function stripTrailingComment(input: string): string {
    let quote: '"' | "'" | null = null
    let escaped = false
    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i]
        if (escaped) {
            escaped = false
            continue
        }
        if (ch === '\\' && quote !== "'") {
            escaped = true
            continue
        }
        if (quote) {
            if (ch === quote) quote = null
            continue
        }
        if (ch === '"' || ch === "'") {
            quote = ch
            continue
        }
        if (ch === '#') {
            return input.slice(0, i)
        }
    }
    return input
}

function splitCommandSegments(command: string): string[] {
    const segments: string[] = []
    let current = ''
    let quote: '"' | "'" | null = null
    let escaped = false

    const flush = () => {
        const segment = stripTrailingComment(current).trim()
        if (segment) segments.push(segment)
        current = ''
    }

    for (let i = 0; i < command.length; i += 1) {
        const ch = command[i]
        if (escaped) {
            current += ch
            escaped = false
            continue
        }

        if (ch === '\\' && quote !== "'") {
            current += ch
            escaped = true
            continue
        }

        if (quote) {
            current += ch
            if (ch === quote) quote = null
            continue
        }

        if (ch === '"' || ch === "'") {
            quote = ch
            current += ch
            continue
        }

        if (ch === ';' || ch === '\n') {
            flush()
            continue
        }

        if (ch === '&') {
            if (command[i + 1] === '&') i += 1
            flush()
            continue
        }

        if (ch === '|') {
            if (command[i + 1] === '|') i += 1
            flush()
            continue
        }

        current += ch
    }

    flush()
    return segments
}

function tokenizeSegment(segment: string): string[] {
    const tokens: string[] = []
    let current = ''
    let quote: '"' | "'" | null = null
    let escaped = false

    const flush = () => {
        if (current) tokens.push(current)
        current = ''
    }

    for (let i = 0; i < segment.length; i += 1) {
        const ch = segment[i]
        if (escaped) {
            current += ch
            escaped = false
            continue
        }

        if (ch === '\\' && quote !== "'") {
            escaped = true
            continue
        }

        if (quote) {
            if (ch === quote) {
                quote = null
            } else {
                current += ch
            }
            continue
        }

        if (ch === '"' || ch === "'") {
            quote = ch
            continue
        }

        if (/\s/.test(ch)) {
            flush()
            continue
        }

        current += ch
    }

    flush()
    return tokens
}

function isEnvAssignment(token: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)
}

function skipWrappers(tokens: string[], start: number): number {
    let cursor = start

    while (cursor < tokens.length) {
        const name = normalizeCommandName(tokens[cursor] ?? '')

        if (name === 'sudo') {
            cursor += 1
            while (cursor < tokens.length) {
                const opt = tokens[cursor] ?? ''
                if (!opt.startsWith('-')) break
                cursor += 1
                if (SUDO_FLAGS_WITH_VALUE.has(opt) && cursor < tokens.length) {
                    cursor += 1
                }
            }
            continue
        }

        if (name === 'env') {
            cursor += 1
            while (cursor < tokens.length) {
                const token = tokens[cursor] ?? ''
                if (token.startsWith('-') || isEnvAssignment(token)) {
                    cursor += 1
                    continue
                }
                break
            }
            continue
        }

        if (name === 'command' || name === 'nohup' || name === 'time') {
            cursor += 1
            continue
        }

        break
    }

    return cursor
}

function parseSegment(segment: string): ParsedSegment | null {
    const tokens = tokenizeSegment(segment)
    if (tokens.length === 0) return null

    let cursor = 0
    while (cursor < tokens.length && isEnvAssignment(tokens[cursor] ?? '')) {
        cursor += 1
    }

    cursor = skipWrappers(tokens, cursor)
    if (cursor >= tokens.length) return null

    const commandName = normalizeCommandName(tokens[cursor] ?? '')
    if (!commandName) return null

    return {
        raw: segment,
        commandName,
        args: tokens.slice(cursor + 1),
    }
}

function isBlockDevicePath(value: string): boolean {
    const path = value.trim().replace(/^['"]|['"]$/g, '')
    return BLOCK_DEVICE_PATH_REGEX.test(path)
}

function isCriticalDeleteTarget(rawTarget: string): boolean {
    const target = rawTarget.trim().replace(/^['"]|['"]$/g, '')
    const lower = target.toLowerCase()

    if (
        lower === '/' ||
        lower === '/*' ||
        lower === '/.*' ||
        lower === '~' ||
        lower === '~/' ||
        lower === '~/*' ||
        lower === '$home' ||
        lower === '$home/' ||
        lower === '$home/*' ||
        lower === '${home}' ||
        lower === '${home}/' ||
        lower === '${home}/*'
    ) {
        return true
    }

    if (target.startsWith('/') && !/[*?[\]{}$]/.test(target)) {
        return pathPosix.normalize(target) === '/'
    }

    return false
}

function isOptionToken(value: string): boolean {
    return value.startsWith('-') && value !== '-'
}

function matchRmRecursiveDelete(segment: ParsedSegment): DangerousCommandMatch | null {
    if (segment.commandName !== 'rm') return null

    let recursive = false
    let cursor = 0
    while (cursor < segment.args.length) {
        const token = segment.args[cursor] ?? ''
        if (token === '--') {
            cursor += 1
            break
        }
        if (!isOptionToken(token)) break

        if (token === '--recursive') {
            recursive = true
            cursor += 1
            continue
        }

        if (token.startsWith('--')) {
            cursor += 1
            continue
        }

        const flags = token.slice(1)
        if (flags.includes('r') || flags.includes('R')) {
            recursive = true
        }
        cursor += 1
    }

    if (!recursive) return null

    const targets = segment.args.slice(cursor)
    for (const target of targets) {
        if (isCriticalDeleteTarget(target)) {
            return {
                ruleId: 'rm_recursive_critical_target',
                matchedSegment: segment.raw,
            }
        }
    }

    return null
}

function matchMkfs(segment: ParsedSegment): DangerousCommandMatch | null {
    if (segment.commandName === 'mkfs' || segment.commandName.startsWith('mkfs.')) {
        return {
            ruleId: 'mkfs_filesystem_create',
            matchedSegment: segment.raw,
        }
    }
    return null
}

function matchDdToBlockDevice(segment: ParsedSegment): DangerousCommandMatch | null {
    if (segment.commandName !== 'dd') return null

    for (let i = 0; i < segment.args.length; i += 1) {
        const token = segment.args[i] ?? ''
        const eqIdx = token.indexOf('=')
        if (eqIdx <= 0) continue

        const key = token.slice(0, eqIdx).toLowerCase()
        const value = token.slice(eqIdx + 1)
        if (key === 'of' && isBlockDevicePath(value)) {
            return {
                ruleId: 'dd_write_block_device',
                matchedSegment: segment.raw,
            }
        }
    }

    for (let i = 0; i < segment.args.length - 1; i += 1) {
        const key = (segment.args[i] ?? '').toLowerCase()
        const value = segment.args[i + 1] ?? ''
        if (key === 'of' && isBlockDevicePath(value)) {
            return {
                ruleId: 'dd_write_block_device',
                matchedSegment: segment.raw,
            }
        }
    }

    return null
}

function matchDiskMutationTool(segment: ParsedSegment): DangerousCommandMatch | null {
    if (!DISK_MUTATION_TOOLS.has(segment.commandName)) return null
    if (!segment.args.some((arg) => isBlockDevicePath(arg))) return null
    return {
        ruleId: 'disk_mutation_block_device',
        matchedSegment: segment.raw,
    }
}

function matchDeviceRedirection(segmentRaw: string): DangerousCommandMatch | null {
    if (!REDIRECT_TO_DEVICE_REGEX.test(segmentRaw)) return null
    return {
        ruleId: 'redirect_block_device',
        matchedSegment: segmentRaw,
    }
}

export function detectDangerousCommand(command: string): DangerousCommandMatch | null {
    for (const segmentRaw of splitCommandSegments(command)) {
        const parsed = parseSegment(segmentRaw)
        if (parsed) {
            const byRm = matchRmRecursiveDelete(parsed)
            if (byRm) return byRm

            const byMkfs = matchMkfs(parsed)
            if (byMkfs) return byMkfs

            const byDd = matchDdToBlockDevice(parsed)
            if (byDd) return byDd

            const byDiskTool = matchDiskMutationTool(parsed)
            if (byDiskTool) return byDiskTool
        }

        const byRedirect = matchDeviceRedirection(segmentRaw)
        if (byRedirect) return byRedirect
    }
    return null
}

export function buildDangerousCommandHintXml(context: GuardContext, match: DangerousCommandMatch): string {
    const commandPreview = previewCommand(context.command)
    const sessionAttr = typeof context.sessionId === 'number' ? ` session_id="${context.sessionId}"` : ''

    return `<system_hint type="tool_call_denied" tool="${escapeXmlAttr(context.toolName)}" reason="dangerous_command" policy="blacklist" rule="${escapeXmlAttr(match.ruleId)}"${sessionAttr} command="${escapeXmlAttr(commandPreview)}">Blocked a high-risk shell command to prevent irreversible data loss. Use a safer and scoped alternative.</system_hint>`
}

export function guardDangerousCommand(context: GuardContext): CommandGuardResult {
    const match = detectDangerousCommand(context.command)
    if (!match) return { blocked: false }
    return {
        blocked: true,
        xml: buildDangerousCommandHintXml(context, match),
        match,
    }
}

export function splitStdinLines(buffer: string): { completedLines: string[]; remainder: string } {
    const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const parts = normalized.split('\n')
    const remainder = parts.pop() ?? ''
    return {
        completedLines: parts,
        remainder,
    }
}

export function trimPendingStdinBuffer(buffer: string): string {
    if (buffer.length <= MAX_STDIN_BUFFER) return buffer
    return buffer.slice(-MAX_STDIN_BUFFER)
}
