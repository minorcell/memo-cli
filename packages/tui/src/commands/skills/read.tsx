import React, { useEffect } from 'react'
import zod from 'zod'
import { dirname } from 'node:path'
import { option, argument } from 'pastel'
import { buildSkillIndex, findSkillByName, findSkillByPath, loadSkills, readSkillBody } from '@memo/core'

export const options = zod.object({
    json: zod
        .boolean()
        .optional()
        .default(false)
        .describe(option({ description: 'Output as JSON', alias: 'j' })),
})

export const args = zod
    .array(zod.string())
    .describe(argument({ name: 'name-or-path', description: 'Skill name or SKILL.md path' }))

export default function SkillsRead({
    options: opts,
    args: positionals,
}: {
    options: zod.infer<typeof options>
    args: zod.infer<typeof args>
}) {
    useEffect(() => {
        async function run() {
            const target = positionals.join(' ')
            if (!target) {
                console.error('Usage: memo skills read <name-or-path>')
                process.exit(1)
                return
            }

            const index = buildSkillIndex(await loadSkills({ cwd: process.cwd() }))
            const record = target.includes('/') ? findSkillByPath(index, target) : findSkillByName(index, target)[0]
            if (!record) {
                const available = index.list.map((skill) => skill.name).join(', ')
                console.error(`Skill not found: ${target}. Available skills: ${available || '(none)'}`)
                process.exit(1)
                return
            }
            if (!target.includes('/') && findSkillByName(index, record.name).length > 1) {
                const candidates = findSkillByName(index, record.name)
                    .map((skill) => `  ${skill.paths.join(' | ')}`)
                    .join('\n')
                console.error(
                    `Skill name "${record.name}" is ambiguous, matches:\n${candidates}\nPass the exact SKILL.md path instead.`,
                )
                process.exit(1)
                return
            }

            const body = await readSkillBody(record)
            if (opts.json) {
                console.log(
                    JSON.stringify(
                        {
                            name: record.name,
                            skill_directory: dirname(record.path),
                            content: body,
                        },
                        null,
                        2,
                    ),
                )
            } else {
                console.log(`# ${record.name}\n`)
                console.log(body)
            }
            process.exit(process.exitCode ?? 0)
        }
        run()
    }, [])

    return null
}
