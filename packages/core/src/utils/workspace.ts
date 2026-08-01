import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'

function trimTrailingSlashes(path: string): string {
    if (path === '/') return path
    return path.replace(/\/+$/g, '')
}

export function normalizeWorkspacePath(input: string): string {
    const resolved = resolve(input.trim())
    const normalized = resolved.replace(/\\/g, '/')
    if (normalized === '/') return normalized
    return trimTrailingSlashes(normalized)
}

export function workspaceIdFromCwd(cwd: string): string {
    const normalized = normalizeWorkspacePath(cwd)
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

export function defaultWorkspaceName(cwd: string): string {
    const normalized = normalizeWorkspacePath(cwd)
    const name = basename(normalized)
    if (name && name !== '.' && name !== '/') return name
    return normalized
}

export function normalizeWorkspaceName(name: string, cwd: string): string {
    const trimmed = name.trim()
    if (trimmed) return trimmed
    return defaultWorkspaceName(cwd)
}

export function cwdBelongsToWorkspace(cwd: string, workspaceCwd: string): boolean {
    const normalizedCwd = normalizeWorkspacePath(cwd)
    const normalizedWorkspace = normalizeWorkspacePath(workspaceCwd)
    if (normalizedCwd === normalizedWorkspace) return true
    return normalizedCwd.startsWith(`${normalizedWorkspace}/`)
}
