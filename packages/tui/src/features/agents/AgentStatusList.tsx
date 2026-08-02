import { memo } from 'react'
import { Box, Text } from 'ink'
import type { AgentActivityView } from '../../shared/types'

export const AgentStatusList = memo(function AgentStatusList({ agents }: { agents: AgentActivityView[] }) {
    if (agents.length === 0) return null

    return (
        <Box flexDirection="column" marginTop={1}>
            <Text color="gray">Sub-agents</Text>
            {agents.map((agent) => {
                const context =
                    agent.contextPercent === undefined ? 'context --' : `context ${agent.contextPercent.toFixed(1)}%`
                const status = agent.status === 'pending_init' ? 'Starting' : 'Working'
                return (
                    <Box key={agent.agentId} justifyContent="space-between">
                        <Box flexShrink={1}>
                            <Text color="yellow">› </Text>
                            <Text bold wrap="truncate-end">
                                {agent.taskName}
                            </Text>
                        </Box>
                        <Text color="gray">
                            {context} · {status}
                        </Text>
                    </Box>
                )
            })}
        </Box>
    )
})
