import { dirname, join, resolve } from 'node:path'
import { statSync, existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { get } from 'node:https'
import { fileURLToPath } from 'node:url'

type PackageInfo = {
    name: string
    version: string
}

type Semver = {
    major: number
    minor: number
    patch: number
    prerelease: string | null
}

function parseSemver(input: string): Semver | null {
    const trimmed = input.trim().replace(/^v/i, '')
    const [main = '', prerelease] = trimmed.split('-', 2)
    const parts = main.split('.').map((part) => Number(part))
    if (parts.length < 3 || parts.some((num) => !Number.isFinite(num))) {
        return null
    }
    return {
        major: parts[0] ?? 0,
        minor: parts[1] ?? 0,
        patch: parts[2] ?? 0,
        prerelease: prerelease ?? null,
    }
}

function isNewerVersion(latest: string, current: string): boolean {
    const latestSemver = parseSemver(latest)
    const currentSemver = parseSemver(current)
    if (!latestSemver || !currentSemver) return false
    if (latestSemver.major !== currentSemver.major) {
        return latestSemver.major > currentSemver.major
    }
    if (latestSemver.minor !== currentSemver.minor) {
        return latestSemver.minor > currentSemver.minor
    }
    if (latestSemver.patch !== currentSemver.patch) {
        return latestSemver.patch > currentSemver.patch
    }
    if (latestSemver.prerelease && !currentSemver.prerelease) return false
    if (!latestSemver.prerelease && currentSemver.prerelease) return true
    if (latestSemver.prerelease && currentSemver.prerelease) {
        return latestSemver.prerelease > currentSemver.prerelease
    }
    return false
}

function resolveStartDir(): string {
    try {
        const modulePath = fileURLToPath(import.meta.url)
        return dirname(modulePath)
    } catch {
        // Fall back to argv/cwd when import.meta.url is unavailable or invalid.
    }
    const start = resolve(process.argv[1] ?? process.cwd())
    try {
        return statSync(start).isFile() ? dirname(start) : start
    } catch {
        return process.cwd()
    }
}

async function readPackageInfo(dir: string): Promise<PackageInfo | null> {
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) return null
    const raw = await readFile(pkgPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PackageInfo>
    if (!parsed.name || !parsed.version) return null
    return { name: parsed.name, version: parsed.version }
}

function readPackageInfoSync(dir: string): PackageInfo | null {
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) return null
    try {
        const raw = readFileSync(pkgPath, 'utf8')
        const parsed = JSON.parse(raw) as Partial<PackageInfo>
        if (!parsed.name || !parsed.version) return null
        return { name: parsed.name, version: parsed.version }
    } catch {
        return null
    }
}

export async function findLocalPackageInfo(): Promise<PackageInfo | null> {
    let dir = resolveStartDir()

    while (true) {
        const info = await readPackageInfo(dir)
        if (info && info.name === '@memo-code/memo') {
            return info
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
    }

    return null
}

export function findLocalPackageInfoSync(): PackageInfo | null {
    let dir = resolveStartDir()

    while (true) {
        const info = readPackageInfoSync(dir)
        if (info && info.name === '@memo-code/memo') {
            return info
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
    }

    return null
}

export async function fetchLatestVersion(packageName: string, timeoutMs = 1500): Promise<string | null> {
    const encoded = encodeURIComponent(packageName)
    const url = `https://registry.npmjs.org/${encoded}/latest`

    return new Promise((resolve) => {
        const req = get(url, { timeout: timeoutMs }, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                res.resume()
                resolve(null)
                return
            }
            const chunks: Buffer[] = []
            res.on('data', (chunk) => chunks.push(chunk))
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                        version?: string
                    }
                    resolve(parsed.version ?? null)
                } catch {
                    resolve(null)
                }
            })
        })
        req.on('timeout', () => {
            req.destroy()
            resolve(null)
        })
        req.on('error', () => resolve(null))
    })
}

export async function checkForUpdate(): Promise<{
    current: string
    latest: string
} | null> {
    const info = await findLocalPackageInfo()
    if (!info) return null
    const latest = await fetchLatestVersion(info.name)
    if (!latest) return null
    if (!isNewerVersion(latest, info.version)) return null
    return { current: info.version, latest }
}
