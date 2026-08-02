import type { ChatMessage } from '@memo/core/types'

export type ForkTurns = 'none' | 'all' | number

export function parseForkTurns(value: string | undefined): ForkTurns {
    const normalized = value?.trim().toLowerCase() || 'all'
    if (normalized === 'none' || normalized === 'all') return normalized
    const parsed = Number.parseInt(normalized, 10)
    if (!/^\d+$/.test(normalized) || parsed <= 0) {
        throw new Error('fork_turns must be `none`, `all`, or a positive integer string')
    }
    return parsed
}

export function buildForkHistory(
    parentHistory: ChatMessage[],
    childSystemPrompt: string,
    forkTurns: ForkTurns,
): ChatMessage[] {
    if (forkTurns === 'none') return [{ role: 'system', content: childSystemPrompt }]

    let source = parentHistory
    if (typeof forkTurns === 'number') {
        const userPositions = parentHistory
            .map((message, index) => (message.role === 'user' ? index : -1))
            .filter((index) => index >= 0)
        const start = userPositions[Math.max(0, userPositions.length - forkTurns)] ?? parentHistory.length
        source = parentHistory.slice(start)
    }

    const inherited = source.flatMap((message): ChatMessage[] => {
        if (message.role === 'user') return [message]
        if (message.role !== 'assistant') return []
        if (typeof message.content === 'string') return message.content ? [message] : []

        const text = message.content
            .filter((part): part is Extract<(typeof message.content)[number], { type: 'text' }> => part.type === 'text')
            .map((part) => part.text)
            .join('')
        return text ? [{ role: 'assistant', content: text }] : []
    })

    return [{ role: 'system', content: childSystemPrompt }, ...inherited]
}

export function buildSubagentSystemPrompt(parentSystemPrompt: string, agentPath: string): string {
    return `${parentSystemPrompt}\n\nYou are sub-agent ${agentPath}. Work only on the assigned task. Preserve repository instructions, coordinate through the collaboration tools when needed, and return a concise result to your parent agent.`
}
