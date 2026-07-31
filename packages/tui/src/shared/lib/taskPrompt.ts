import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE_PATTERN = /{{\s*([\w.-]+)\s*}}/g

type TaskPromptTemplate = 'init_agents' | 'review_pull_request'

function renderTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(TEMPLATE_PATTERN, (_match, key: string) => vars[key] ?? '')
}

export async function loadTaskPrompt(template: TaskPromptTemplate, vars: Record<string, string> = {}): Promise<string> {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const promptPath = join(__dirname, '../../task-prompts', `${template}.md`)
    const prompt = await readFile(promptPath, 'utf-8')
    return renderTemplate(prompt, vars)
}
