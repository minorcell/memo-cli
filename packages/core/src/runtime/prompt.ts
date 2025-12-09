import prompt from './prompt.md' with { type: 'text' }

/**
 * 读取内置的系统提示词模板。
 * 可在外部通过依赖注入覆盖。
 */
export async function loadSystemPrompt(): Promise<string> {
    return prompt
}
