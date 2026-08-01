import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getRuntimeCwd } from '@memo/core/tools/runtime/context'
import { expandHome, normalizePath } from './path-utils'

const FS_ALLOWED_ROOTS_ENV = 'MEMO_FS_ALLOWED_ROOTS'

function parseCsv(raw: string | undefined): string[] {
    if (!raw?.trim()) {
        return []
    }

    return raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
}

async function resolveRootVariants(root: string): Promise<string[]> {
    const expanded = expandHome(root)
    const absolute = path.resolve(expanded)
    const normalizedOriginal = normalizePath(absolute)

    try {
        const resolved = await fs.realpath(absolute)
        const normalizedResolved = normalizePath(resolved)
        if (normalizedOriginal !== normalizedResolved) {
            return [normalizedOriginal, normalizedResolved]
        }
        return [normalizedResolved]
    } catch {
        return [normalizedOriginal]
    }
}

async function filterAccessibleDirectories(dirs: string[]): Promise<string[]> {
    const accessible: string[] = []

    for (const dir of dirs) {
        try {
            const stats = await fs.stat(dir)
            if (stats.isDirectory()) {
                accessible.push(dir)
            }
        } catch {
            // Ignore inaccessible roots.
        }
    }

    return accessible
}

/**
 * Resolves effective filesystem roots from runtime cwd + optional env overrides.
 */
export async function resolveAllowedDirectories(): Promise<string[]> {
    const runtimeCwd = getRuntimeCwd()
    const configured = parseCsv(process.env[FS_ALLOWED_ROOTS_ENV])
    const requestedRoots = [runtimeCwd, ...configured]

    const deduped = new Set<string>()
    for (const root of requestedRoots) {
        const variants = await resolveRootVariants(root)
        for (const variant of variants) {
            deduped.add(variant)
        }
    }

    const normalized = Array.from(deduped)
    const accessible = await filterAccessibleDirectories(normalized)

    if (accessible.length > 0) {
        return accessible
    }

    if (normalized.length > 0) {
        return normalized
    }

    return [normalizePath(path.resolve(runtimeCwd))]
}

export function getAllowedDirectoriesEnvName() {
    return FS_ALLOWED_ROOTS_ENV
}
