import { resolve } from 'node:path'

const AGENTS_FILE = 'AGENTS.md'
const PATCH_WRITE_HEADER_RE = /\*{3}\s+(?:Add|Update)\s+File:\s+([^\r\n]+)/g

/**
 * True if a tool call writes only <cwd>/AGENTS.md.
 * Used as the approval gate for `memo init`: the model may write AGENTS.md
 * and nothing else.
 */
export function isAgentsMdWrite(toolName: string, params: unknown, cwd: string): boolean {
    const target = resolve(cwd, AGENTS_FILE)
    switch (toolName) {
        case 'write_file':
        case 'edit_file': {
            const raw = (params as { path?: unknown } | null | undefined)?.path
            if (typeof raw !== 'string' || raw.trim() === '') return false
            return resolve(cwd, raw) === target
        }
        case 'apply_patch': {
            const input = (params as { input?: unknown } | null | undefined)?.input
            if (typeof input !== 'string') return false
            const targets = [...input.matchAll(PATCH_WRITE_HEADER_RE)].map((m) => resolve(cwd, m[1]!.trim()))
            return targets.length > 0 && targets.every((t) => t === target)
        }
        default:
            return false
    }
}
