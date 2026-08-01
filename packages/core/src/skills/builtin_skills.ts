import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILTIN_SKILLS = ['skill-creator'] as const

/**
 * Marker file written into an installed builtin skill directory. Records the
 * fingerprint of the tree that was installed, so a later run can tell
 * "untouched copy from an older release" (upgrade it) from "user modified
 * or externally created" (never touch it). Not named like a SKILL.md, so the
 * skills scan never picks it up.
 */
export const BUILTIN_MARKER = '.memo-builtin.json'

export type InstallBuiltinSkillsOptions = {
    memoHome: string
    /** Test injection; defaults to probing the packaged builtin directory. */
    sourceRoot?: string
}

/**
 * Idempotently install Memo's builtin skills into $MEMO_HOME/skills before
 * the skills scan. Three states per skill:
 *
 * - missing -> fresh install (copy + write marker)
 * - identical tree -> no-op
 * - different tree: marker matches current tree (untouched copy of an older
 *   release) -> overwrite upgrade; otherwise (user-modified or foreign) -> skip
 */
export async function installBuiltinSkills(options: InstallBuiltinSkillsOptions): Promise<void> {
    const builtinRoot = options.sourceRoot ?? resolveBuiltinRoot()
    const skillsDir = join(options.memoHome, 'skills')

    for (const name of BUILTIN_SKILLS) {
        const src = join(builtinRoot, name)
        const dest = join(skillsDir, name)
        const markerPath = join(dest, BUILTIN_MARKER)
        const fingerprint = await treeFingerprint(src)

        if (!existsSync(join(dest, 'SKILL.md'))) {
            await mkdir(dest, { recursive: true })
            await cp(src, dest, { recursive: true })
            await writeFile(markerPath, fingerprint, 'utf8')
            continue
        }

        const destFingerprint = await treeFingerprint(dest)
        if (destFingerprint === fingerprint) {
            continue
        }

        let marker: string | null = null
        try {
            marker = (await readFile(markerPath, 'utf8')).trim()
        } catch {
            marker = null
        }
        if (marker === destFingerprint) {
            // Untouched copy from an older release: upgrade it.
            await cp(src, dest, { recursive: true })
            await writeFile(markerPath, fingerprint, 'utf8')
        }
        // Otherwise the directory was modified by the user or installed by
        // something else - leave it alone.
    }
}

/**
 * Locate the builtin skills source tree. Dev (tsx) runs from
 * src/skills/builtin_skills.ts; the packed dist/index.js has the module
 * directory at dist/, with the tree copied to dist/skills/builtin by tsup.
 */
export function resolveBuiltinRoot(): string {
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    const candidates = [join(moduleDir, 'builtin'), join(moduleDir, '..', 'skills', 'builtin')]
    for (const candidate of candidates) {
        if (existsSync(join(candidate, 'skill-creator', 'SKILL.md'))) {
            return candidate
        }
    }
    throw new Error(`builtin skills directory not found (tried: ${candidates.join(', ')})`)
}

async function treeFingerprint(dir: string): Promise<string> {
    const files: string[] = []
    await collectFiles(dir, '', files)
    files.sort()

    const root = createHash('sha256')
    for (const relPath of files) {
        const content = await readFile(join(dir, relPath))
        const fileHash = createHash('sha256').update(content).digest('hex')
        root.update(`${relPath}\0${fileHash}\n`)
    }
    return root.digest('hex')
}

async function collectFiles(dir: string, prefix: string, out: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
        if (entry.name === BUILTIN_MARKER) continue
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            await collectFiles(fullPath, relPath, out)
        } else if (entry.isFile()) {
            out.push(relPath)
        }
    }
}
