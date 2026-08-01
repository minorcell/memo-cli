#!/usr/bin/env node
/**
 * Quick validation script for skills - minimal version
 *
 * Usage:
 *     node quick_validate.mjs <skill-directory>
 *
 * Semantics align with Memo's skill loader (parseSkillFile in skills.ts):
 * a skill that passes this check is guaranteed to be loadable by Memo.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_SKILL_NAME_LENGTH = 64
const ALLOWED_PROPERTIES = ['name', 'description', 'license', 'allowed-tools', 'metadata']

function unquote(value) {
    const trimmed = value.trim()
    if (trimmed.length >= 2) {
        const first = trimmed[0]
        const last = trimmed[trimmed.length - 1]
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1)
        }
    }
    return trimmed
}

async function validateSkill(skillPath) {
    const skillMdPath = join(skillPath, 'SKILL.md')
    let content
    try {
        content = await readFile(skillMdPath, 'utf8')
    } catch {
        return { valid: false, message: 'SKILL.md not found' }
    }

    if (!content.startsWith('---')) {
        return { valid: false, message: 'No YAML frontmatter found' }
    }

    const match = content.match(/^---\n(.*?)\n---/s)
    if (!match) {
        return { valid: false, message: 'Invalid frontmatter format' }
    }

    // Parse simple key: value lines (matches the flat frontmatter Memo supports).
    const frontmatter = {}
    for (const line of match[1].split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue
        const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
        if (!m) {
            return { valid: false, message: `Invalid YAML in frontmatter: '${line.trim()}'` }
        }
        frontmatter[m[1]] = unquote(m[2])
    }

    const unexpectedKeys = Object.keys(frontmatter).filter((key) => !ALLOWED_PROPERTIES.includes(key))
    if (unexpectedKeys.length > 0) {
        const allowed = [...ALLOWED_PROPERTIES].sort().join(', ')
        return {
            valid: false,
            message: `Unexpected key(s) in SKILL.md frontmatter: ${unexpectedKeys.sort().join(', ')}. Allowed properties are: ${allowed}`,
        }
    }

    if (!('name' in frontmatter)) {
        return { valid: false, message: "Missing 'name' in frontmatter" }
    }
    if (!('description' in frontmatter)) {
        return { valid: false, message: "Missing 'description' in frontmatter" }
    }

    const name = frontmatter.name.trim()
    if (name) {
        if (!/^[a-z0-9-]+$/.test(name)) {
            return {
                valid: false,
                message: `Name '${name}' should be hyphen-case (lowercase letters, digits, and hyphens only)`,
            }
        }
        if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) {
            return {
                valid: false,
                message: `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`,
            }
        }
        if (name.length > MAX_SKILL_NAME_LENGTH) {
            return {
                valid: false,
                message: `Name is too long (${name.length} characters). Maximum is ${MAX_SKILL_NAME_LENGTH} characters.`,
            }
        }
    }

    const description = frontmatter.description.trim()
    if (description) {
        if (description.includes('<') || description.includes('>')) {
            return { valid: false, message: 'Description cannot contain angle brackets (< or >)' }
        }
        if (description.length > 1024) {
            return {
                valid: false,
                message: `Description is too long (${description.length} characters). Maximum is 1024 characters.`,
            }
        }
    }

    return { valid: true, message: 'Skill is valid!' }
}

const skillPath = process.argv[2]
if (!skillPath) {
    console.error('Usage: node quick_validate.mjs <skill_directory>')
    process.exit(1)
}

const { valid, message } = await validateSkill(skillPath)
console.log(message)
process.exit(valid ? 0 : 1)
