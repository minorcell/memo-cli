import { dirname } from 'node:path'
import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import { buildSkillIndex, findSkillByName, findSkillByPath, loadSkills, readSkillBody } from '@memo/core/skills/skills'
import type { SkillIndex, SkillMetadata } from '@memo/core/skills/skills'

const READ_SKILL_INPUT_SCHEMA = z
    .object({
        name: z.string().min(1).optional(),
        path: z.string().min(1).optional(),
    })
    .strict()
    .refine((input) => Boolean(input.name) !== Boolean(input.path), {
        message: 'Provide exactly one of name or path',
    })

export const readSkillTool = tool({
    description:
        'Loads the full SKILL.md of a skill listed in the Skills directory (frontmatter stripped). Pass the skill name from the directory, or the exact SKILL.md path when names are ambiguous. Resolve relative paths (scripts/, references/) against the returned skill_directory. Very long skills may be truncated.',
    inputSchema: READ_SKILL_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: true, isMutating: false } },

    execute: async ({ name, path }, options) => {
        const ctx = options.experimental_context as { skillIndex?: SkillIndex } | undefined
        const index = ctx?.skillIndex ?? buildSkillIndex(await loadSkills())

        let record: SkillMetadata | undefined
        if (path) {
            record = findSkillByPath(index, path)
            if (!record) {
                return textResult(`skill not found for path=${path}. Use a name from the Skills directory.`, true)
            }
        } else if (name) {
            const matches = findSkillByName(index, name)
            if (matches.length === 0) {
                const available = index.list.map((skill) => skill.name).join(', ')
                return textResult(`skill not found: ${name}. Available skills: ${available || '(none)'}`, true)
            }
            if (matches.length > 1) {
                const candidates = matches.map((skill) => skill.paths.join(' | ')).join(', ')
                return textResult(
                    `skill name "${name}" is ambiguous, matches: ${candidates}. Pass the exact SKILL.md path instead.`,
                    true,
                )
            }
            record = matches[0]
        }

        try {
            const body = await readSkillBody(record!)
            return textResult(
                JSON.stringify(
                    {
                        name: record!.name,
                        skill_directory: dirname(record!.path),
                        content: body,
                    },
                    null,
                    2,
                ),
            )
        } catch (err) {
            return textResult(`failed to read skill: ${(err as Error).message}`, true)
        }
    },
})
