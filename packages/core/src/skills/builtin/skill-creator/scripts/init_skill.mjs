#!/usr/bin/env node
/**
 * Skill Initializer - Creates a new skill from template
 *
 * Usage:
 *     node init_skill.mjs <skill-name> --path <path> [--resources scripts,references,assets] [--examples]
 *
 * Examples:
 *     node init_skill.mjs my-new-skill --path skills/public
 *     node init_skill.mjs my-new-skill --path skills/public --resources scripts,references
 *     node init_skill.mjs my-api-helper --path skills/private --resources scripts --examples
 *     node init_skill.mjs custom-skill --path /custom/location
 */

import { access, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const MAX_SKILL_NAME_LENGTH = 64
const ALLOWED_RESOURCES = ['scripts', 'references', 'assets']

const SKILL_TEMPLATE = `---
name: {skill_name}
description: [TODO: Complete and informative explanation of what the skill does and when to use it. Include WHEN to use this skill - specific scenarios, file types, or tasks that trigger it.]
---

# {skill_title}

## Overview

[TODO: 1-2 sentences explaining what this skill enables]

## Structuring This Skill

[TODO: Choose the structure that best fits this skill's purpose. Common patterns:

**1. Workflow-Based** (best for sequential processes)
- Works well when there are clear step-by-step procedures
- Example: DOCX skill with "Workflow Decision Tree" -> "Reading" -> "Creating" -> "Editing"
- Structure: ## Overview -> ## Workflow Decision Tree -> ## Step 1 -> ## Step 2...

**2. Task-Based** (best for tool collections)
- Works well when the skill offers different operations/capabilities
- Example: PDF skill with "Quick Start" -> "Merge PDFs" -> "Split PDFs" -> "Extract Text"
- Structure: ## Overview -> ## Quick Start -> ## Task Category 1 -> ## Task Category 2...

**3. Reference/Guidelines** (best for standards or specifications)
- Works well for brand guidelines, coding standards, or requirements
- Example: Brand styling with "Brand Guidelines" -> "Colors" -> "Typography" -> "Features"
- Structure: ## Overview -> ## Guidelines -> ## Specifications -> ## Usage...

**4. Capabilities-Based** (best for integrated systems)
- Works well when the skill provides multiple interrelated features
- Example: Product Management with "Core Capabilities" -> numbered capability list
- Structure: ## Overview -> ## Core Capabilities -> ### 1. Feature -> ### 2. Feature...

Patterns can be mixed and matched as needed. Most skills combine patterns (e.g., start with task-based, add workflow for complex operations).

Delete this entire "Structuring This Skill" section when done - it's just guidance.]

## [TODO: Replace with the first main section based on chosen structure]

[TODO: Add content here. See examples in existing skills:
- Code samples for technical skills
- Decision trees for complex workflows
- Concrete examples with realistic user requests
- References to scripts/templates/references as needed]

## Resources (optional)

Create only the resource directories this skill actually needs. Delete this section if no resources are required.

### scripts/
Executable code (Node .mjs scripts, shell scripts, etc.) that can be run directly to perform specific operations.

**Appropriate for:** Node scripts, shell scripts, or any executable code that performs automation, data processing, or specific operations.

**Note:** Scripts may be executed without loading into context, but can still be read by Memo for patching or environment adjustments.

### references/
Documentation and reference material intended to be loaded into context to inform Memo's process and thinking.

**Appropriate for:** In-depth documentation, API references, database schemas, comprehensive guides, or any detailed information that Memo should reference while working.

### assets/
Files not intended to be loaded into context, but rather used within the output Memo produces.

**Appropriate for:** Templates, boilerplate code, document templates, images, icons, fonts, or any files meant to be copied or used in the final output.

---

**Not every skill requires all three types of resources.**
`

const EXAMPLE_SCRIPT = `#!/usr/bin/env node
/**
 * Example helper script for {skill_name}
 *
 * This is a placeholder script that can be executed directly.
 * Replace with actual implementation or delete if not needed.
 */

console.log("This is an example script for {skill_name}")
// TODO: Add actual script logic here
// This could be data processing, file conversion, API calls, etc.
`

const EXAMPLE_REFERENCE = `# Reference Documentation for {skill_title}

This is a placeholder for detailed reference documentation.
Replace with actual reference content or delete if not needed.

## When Reference Docs Are Useful

Reference docs are ideal for:
- Comprehensive API documentation
- Detailed workflow guides
- Complex multi-step processes
- Information too lengthy for main SKILL.md
- Content that's only needed for specific use cases

## Structure Suggestions

### API Reference Example
- Overview
- Authentication
- Endpoints with examples
- Error codes
- Rate limits

### Workflow Guide Example
- Prerequisites
- Step-by-step instructions
- Common patterns
- Troubleshooting
- Best practices
`

const EXAMPLE_ASSET = `# Example Asset File

This placeholder represents where asset files would be stored.
Replace with actual asset files (templates, images, fonts, etc.) or delete if not needed.

Asset files are NOT intended to be loaded into context, but rather used within
the output Memo produces.

## Common Asset Types

- Templates: .pptx, .docx, boilerplate directories
- Images: .png, .jpg, .svg, .gif
- Fonts: .ttf, .otf, .woff, .woff2
- Boilerplate code: Project directories, starter files
- Icons: .ico, .svg
- Data files: .csv, .json, .xml, .yaml

Note: This is a text placeholder. Actual assets can be any file type.
`

function normalizeSkillName(name) {
    const normalized = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-')
    return normalized
}

function titleCaseSkillName(skillName) {
    return skillName
        .split('-')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

function parseResources(rawResources) {
    if (!rawResources) return []
    const resources = rawResources
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    const invalid = [...new Set(resources.filter((item) => !ALLOWED_RESOURCES.includes(item)))].sort()
    if (invalid.length > 0) {
        console.error(`[ERROR] Unknown resource type(s): ${invalid.join(', ')}`)
        console.error(`   Allowed: ${[...ALLOWED_RESOURCES].sort().join(', ')}`)
        process.exit(1)
    }
    return [...new Set(resources)]
}

async function createResourceDirs(skillDir, skillName, skillTitle, resources, includeExamples) {
    for (const resource of resources) {
        const resourceDir = join(skillDir, resource)
        await mkdir(resourceDir, { recursive: true })
        if (resource === 'scripts') {
            if (includeExamples) {
                const example = EXAMPLE_SCRIPT.replaceAll('{skill_name}', skillName)
                await writeFile(join(resourceDir, 'example.mjs'), example)
                console.log('[OK] Created scripts/example.mjs')
            } else {
                console.log('[OK] Created scripts/')
            }
        } else if (resource === 'references') {
            if (includeExamples) {
                const example = EXAMPLE_REFERENCE.replaceAll('{skill_title}', skillTitle)
                await writeFile(join(resourceDir, 'api_reference.md'), example)
                console.log('[OK] Created references/api_reference.md')
            } else {
                console.log('[OK] Created references/')
            }
        } else if (resource === 'assets') {
            if (includeExamples) {
                await writeFile(join(resourceDir, 'example_asset.txt'), EXAMPLE_ASSET)
                console.log('[OK] Created assets/example_asset.txt')
            } else {
                console.log('[OK] Created assets/')
            }
        }
    }
}

async function initSkill(skillName, path, resources, includeExamples) {
    const skillDir = join(resolve(path), skillName)

    try {
        await access(skillDir)
        console.error(`[ERROR] Skill directory already exists: ${skillDir}`)
        return null
    } catch {
        // directory does not exist, proceed
    }

    try {
        await mkdir(skillDir, { recursive: false })
        console.log(`[OK] Created skill directory: ${skillDir}`)
    } catch (error) {
        console.error(`[ERROR] Error creating directory: ${error.message}`)
        return null
    }

    const skillTitle = titleCaseSkillName(skillName)
    const skillContent = SKILL_TEMPLATE.replaceAll('{skill_name}', skillName).replaceAll('{skill_title}', skillTitle)

    try {
        await writeFile(join(skillDir, 'SKILL.md'), skillContent)
        console.log('[OK] Created SKILL.md')
    } catch (error) {
        console.error(`[ERROR] Error creating SKILL.md: ${error.message}`)
        return null
    }

    if (resources.length > 0) {
        try {
            await createResourceDirs(skillDir, skillName, skillTitle, resources, includeExamples)
        } catch (error) {
            console.error(`[ERROR] Error creating resource directories: ${error.message}`)
            return null
        }
    }

    console.log(`\n[OK] Skill '${skillName}' initialized successfully at ${skillDir}`)
    console.log('\nNext steps:')
    console.log('1. Edit SKILL.md to complete the TODO items and update the description')
    if (resources.length > 0) {
        if (includeExamples) {
            console.log('2. Customize or delete the example files in scripts/, references/, and assets/')
        } else {
            console.log('2. Add resources to scripts/, references/, and assets/ as needed')
        }
    } else {
        console.log('2. Create resource directories only if needed (scripts/, references/, assets/)')
    }
    console.log('3. Run the validator when ready to check the skill structure')
    console.log('4. Forward-test complex skills with realistic user requests to ensure they work as intended')

    return skillDir
}

async function main() {
    let parsed
    try {
        parsed = parseArgs({
            args: process.argv.slice(2),
            allowPositionals: true,
            options: {
                path: { type: 'string' },
                resources: { type: 'string', default: '' },
                examples: { type: 'boolean', default: false },
            },
        })
    } catch (error) {
        console.error(`[ERROR] ${error.message}`)
        console.error('Usage: node init_skill.mjs <skill-name> --path <output-directory> [--resources scripts,references,assets] [--examples]')
        process.exit(1)
    }

    const rawSkillName = parsed.positionals[0]
    if (!rawSkillName) {
        console.error('[ERROR] Skill name is required.')
        console.error('Usage: node init_skill.mjs <skill-name> --path <output-directory> [--resources scripts,references,assets] [--examples]')
        process.exit(1)
    }

    const skillName = normalizeSkillName(rawSkillName)
    if (!skillName) {
        console.error('[ERROR] Skill name must include at least one letter or digit.')
        process.exit(1)
    }
    if (skillName.length > MAX_SKILL_NAME_LENGTH) {
        console.error(
            `[ERROR] Skill name '${skillName}' is too long (${skillName.length} characters). Maximum is ${MAX_SKILL_NAME_LENGTH} characters.`,
        )
        process.exit(1)
    }
    if (skillName !== rawSkillName.trim()) {
        console.log(`Note: Normalized skill name from '${rawSkillName}' to '${skillName}'.`)
    }

    const resources = parseResources(parsed.values.resources)
    if (parsed.values.examples && resources.length === 0) {
        console.error('[ERROR] --examples requires --resources to be set.')
        process.exit(1)
    }

    const path = parsed.values.path
    if (!path) {
        console.error('[ERROR] --path is required.')
        console.error('Usage: node init_skill.mjs <skill-name> --path <output-directory> [--resources scripts,references,assets] [--examples]')
        process.exit(1)
    }

    console.log(`Initializing skill: ${skillName}`)
    console.log(`   Location: ${path}`)
    if (resources.length > 0) {
        console.log(`   Resources: ${resources.join(', ')}`)
        if (parsed.values.examples) {
            console.log('   Examples: enabled')
        }
    } else {
        console.log('   Resources: none (create as needed)')
    }
    console.log()

    const result = await initSkill(skillName, path, resources, parsed.values.examples)
    process.exit(result ? 0 : 1)
}

await main()
