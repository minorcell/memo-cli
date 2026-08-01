import React, { useEffect } from 'react'
import zod from 'zod'
import { option } from 'pastel'
import { loadMemoConfig, loadSkills, type SkillMetadata } from '@memo/core'

export const options = zod.object({
    json: zod
        .boolean()
        .optional()
        .default(false)
        .describe(option({ description: 'Output as JSON', alias: 'j' })),
})

function isActive(skill: SkillMetadata, activePaths: Set<string>): boolean {
    return skill.paths.some((path) => activePaths.has(path))
}

export default function SkillsList({ options: opts }: { options: zod.infer<typeof options> }) {
    useEffect(() => {
        async function run() {
            const loaded = await loadMemoConfig()
            const activePaths = new Set((loaded.config.active_skills ?? []).map((p) => p))
            const skills = await loadSkills({ cwd: process.cwd() })

            if (opts.json) {
                console.log(
                    JSON.stringify(
                        {
                            count: skills.length,
                            skills: skills.map((skill) => ({
                                name: skill.name,
                                description: skill.description,
                                scope: skill.scope,
                                path: skill.path,
                                paths: skill.paths,
                                hash: skill.hash,
                                sourceRoot: skill.sourceRoot,
                                active: isActive(skill, activePaths),
                            })),
                        },
                        null,
                        2,
                    ),
                )
            } else if (skills.length === 0) {
                console.log(
                    'No skills found. Add a SKILL.md under .agents/skills, .claude/skills, .codex/skills, or ~/.memo/skills.',
                )
            } else {
                console.log(`Skills (${skills.length}):`)
                for (const skill of skills) {
                    const active = isActive(skill, activePaths)
                    console.log(`[${skill.scope}${active ? ' ✓' : ''}] ${skill.name}: ${skill.description}`)
                    console.log(`    ${skill.path}`)
                }
                console.log('\nActive skills are marked with ✓. Use "memo skills read <name>" to view a skill.')
            }
            process.exit(process.exitCode ?? 0)
        }
        run()
    }, [])

    return null
}
