import type { ChatMessage } from '@memo/core/types'

const MAX_MESSAGE_CONTENT_CHARS = 4_000

export const CONTEXT_COMPACTION_SYSTEM_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`

export const CONTEXT_SUMMARY_PREFIX =
    'Another language model started to solve this problem and produced a summary of its thinking process. Use this summary to continue the task without redoing completed work.'

function normalizeContent(content: string): string {
    const compact = content.replace(/\r\n/g, '\n').trim()
    if (compact.length <= MAX_MESSAGE_CONTENT_CHARS) {
        return compact
    }
    return `${compact.slice(0, MAX_MESSAGE_CONTENT_CHARS)}...`
}

function messageToTranscriptLine(message: ChatMessage, index: number): string {
    const role = message.role.toUpperCase()
    if (message.role === 'assistant') {
        const parts = Array.isArray(message.content) ? message.content : []
        const toolCalls = parts.filter((part) => part.type === 'tool-call')
        const text =
            typeof message.content === 'string'
                ? message.content
                : parts
                      .filter((part) => part.type === 'text')
                      .map((part) => part.text)
                      .join('')
        if (toolCalls.length) {
            const toolNames = toolCalls.map((part) => part.toolName).join(', ')
            return `[${index}] ${role} (tool_calls: ${toolNames})\n${normalizeContent(text)}`
        }
        return `[${index}] ${role}\n${normalizeContent(text)}`
    }
    if (message.role === 'tool') {
        const part = Array.isArray(message.content) ? message.content[0] : undefined
        const toolName = part?.type === 'tool-result' ? part.toolName : ''
        const text = part?.type === 'tool-result' && part.output.type === 'text' ? part.output.value : ''
        return `[${index}] ${role}${toolName ? ` (${toolName})` : ''}\n${normalizeContent(text)}`
    }
    const content = typeof message.content === 'string' ? message.content : ''
    return `[${index}] ${role}\n${normalizeContent(content)}`
}

export function isContextSummaryMessage(message: ChatMessage): boolean {
    if (message.role !== 'user') return false
    return typeof message.content === 'string' && message.content.startsWith(`${CONTEXT_SUMMARY_PREFIX}\n`)
}

export function buildCompactionUserPrompt(messages: ChatMessage[]): string {
    const transcript = messages.length
        ? messages.map((message, index) => messageToTranscriptLine(message, index)).join('\n\n')
        : '(empty)'

    return [
        'Conversation history to summarize:',
        transcript,
        '',
        'Return only the summary body in plain text. Do not add markdown fences.',
    ].join('\n')
}
