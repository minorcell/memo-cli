import path from 'node:path'
import os from 'node:os'

/**
 * Converts WSL or Unix-style Windows paths to Windows format.
 */
export function convertToWindowsPath(rawPath: string): string {
    if (rawPath.startsWith('/mnt/')) {
        return rawPath
    }

    if (rawPath.match(/^\/[a-zA-Z]\//) && process.platform === 'win32') {
        const driveLetter = rawPath.charAt(1).toUpperCase()
        const pathPart = rawPath.slice(2).replace(/\//g, '\\\\')
        return `${driveLetter}:${pathPart}`
    }

    if (rawPath.match(/^[a-zA-Z]:/)) {
        return rawPath.replace(/\//g, '\\\\')
    }

    return rawPath
}

/**
 * Normalizes paths while preserving cross-platform behavior.
 */
export function normalizePath(rawPath: string): string {
    let normalized = rawPath.trim().replace(/^["']|["']$/g, '')

    const isUnixPath =
        normalized.startsWith('/') &&
        (normalized.match(/^\/mnt\/[a-z]\//i) ||
            process.platform !== 'win32' ||
            (process.platform === 'win32' && !normalized.match(/^\/[a-zA-Z]\//)))

    if (isUnixPath) {
        return normalized.replace(/\/+/g, '/').replace(/(?<!^)\/$/, '') || '/'
    }

    normalized = convertToWindowsPath(normalized)

    if (normalized.startsWith('\\\\')) {
        let uncPath = normalized.replace(/^\\{2,}/, '\\\\')
        const rest = uncPath.substring(2).replace(/\\\\/g, '\\')
        normalized = `\\\\${rest}`
    } else {
        normalized = normalized.replace(/\\\\/g, '\\')
    }

    normalized = path.normalize(normalized)

    if (rawPath.startsWith('\\\\') && !normalized.startsWith('\\\\')) {
        normalized = `\\${normalized}`
    }

    if (normalized.match(/^[a-zA-Z]:/)) {
        let result = normalized.replace(/\//g, '\\\\')
        if (/^[a-z]:/.test(result)) {
            result = result.charAt(0).toUpperCase() + result.slice(1)
        }
        return result
    }

    if (process.platform === 'win32') {
        return normalized.replace(/\//g, '\\\\')
    }

    return normalized
}

/**
 * Expands `~` to the current user's home directory.
 */
export function expandHome(filepath: string): string {
    if (filepath.startsWith('~/') || filepath === '~') {
        return path.join(os.homedir(), filepath.slice(1))
    }
    return filepath
}
