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
    'Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:'

function normalizeContent(content: string): string {
    const compact = content.replace(/\r\n/g, '\n').trim()
    if (compact.length <= MAX_MESSAGE_CONTENT_CHARS) {
        return compact
    }
    // Keep the tail: tool output carries its result/error at the end, while the
    // head is usually command echoes and noise.
    return `...${compact.slice(-MAX_MESSAGE_CONTENT_CHARS)}`
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

/**
 * Drop the oldest messages so the serialized transcript fits within
 * budgetTokens, keeping the newest message unconditionally. Returns the
 * selected messages in their original order (indices are preserved — gaps
 * mark the dropped messages).
 */
export function selectCompactionMessages(
    messages: ChatMessage[],
    budgetTokens: number,
    countTokens: (text: string) => number,
): ChatMessage[] {
    if (!messages.length) {
        return []
    }

    const selected: ChatMessage[] = []
    let used = 0
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (!message) {
            continue
        }
        const tokens = countTokens(messageToTranscriptLine(message, i)) + 1 // +1 for the '\n\n' separator
        if (selected.length > 0 && used + tokens > budgetTokens) {
            break
        }
        selected.push(message)
        used += tokens
        if (used >= budgetTokens) {
            break
        }
    }
    selected.reverse()
    return selected
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
