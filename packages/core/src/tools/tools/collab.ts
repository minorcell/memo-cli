import { z } from 'zod'
import { tool, type ToolExecutionOptions } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import type { ToolExecutionContext } from '@memo/core/tools/sdk_tools'
import type { CollabSessionBinding } from '@memo/core/agent/control'

const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const MIN_WAIT_TIMEOUT_MS = 10_000
const MAX_WAIT_TIMEOUT_MS = 300_000

const SPAWN_AGENT_INPUT_SCHEMA = z
    .object({
        message: z.string().min(1),
        task_name: z.string().min(1),
        agent_type: z.string().optional(),
        fork_turns: z.string().optional(),
    })
    .strict()

const MESSAGE_INPUT_SCHEMA = z
    .object({
        target: z.string().min(1),
        message: z.string().min(1),
    })
    .strict()

const WAIT_AGENT_INPUT_SCHEMA = z
    .object({
        timeout_ms: z.number().int().positive().optional(),
    })
    .strict()

const TARGET_INPUT_SCHEMA = z
    .object({
        target: z.string().min(1),
    })
    .strict()

const LIST_AGENTS_INPUT_SCHEMA = z
    .object({
        path_prefix: z.string().min(1).optional(),
    })
    .strict()

function collabBinding(options: ToolExecutionOptions): CollabSessionBinding {
    const context = options.experimental_context as ToolExecutionContext | undefined
    if (!context?.collab) throw new Error('collaboration tools require an active agent session')
    return context.collab
}

function compactAgent(agent: {
    agentId: string
    agentPath: string
    taskName: string
    status: string
    lastMessage?: string
    error?: string
}) {
    return {
        agent_id: agent.agentId,
        agent_path: agent.agentPath,
        task_name: agent.taskName,
        status: agent.status,
        last_message: agent.lastMessage ?? null,
        error: agent.error ?? null,
    }
}

function toolFailure(name: string, error: unknown) {
    return textResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`, true)
}

function nonEmptyMessage(value: string): string {
    const message = value.trim()
    if (!message) throw new Error('message must not be empty')
    return message
}

const collabMetadata = { memo: { supportsParallelToolCalls: true, isMutating: false } }

export const spawnAgentTool = tool({
    description: 'Spawn an in-process sub-agent for a well-scoped task.',
    inputSchema: SPAWN_AGENT_INPUT_SCHEMA,
    metadata: collabMetadata,
    execute: async ({ message, task_name, fork_turns }, options) => {
        try {
            const sender = collabBinding(options)
            const agent = await sender.control.spawnAgent(sender, {
                message: nonEmptyMessage(message),
                taskName: task_name,
                forkTurns: fork_turns,
            })
            return textResult(JSON.stringify(compactAgent(agent), null, 2))
        } catch (error) {
            return toolFailure('spawn_agent', error)
        }
    },
})

export const sendMessageTool = tool({
    description: 'Queue a message for an agent without starting an idle turn.',
    inputSchema: MESSAGE_INPUT_SCHEMA,
    metadata: collabMetadata,
    execute: async ({ target, message }, options) => {
        try {
            const sender = collabBinding(options)
            const receiver = sender.control.sendMessage(sender, target, nonEmptyMessage(message), false)
            return textResult(JSON.stringify({ target: receiver.agentPath, queued: true }, null, 2))
        } catch (error) {
            return toolFailure('send_message', error)
        }
    },
})

export const followupTaskTool = tool({
    description: 'Send follow-up work to an agent and start a turn if it is idle.',
    inputSchema: MESSAGE_INPUT_SCHEMA,
    metadata: collabMetadata,
    execute: async ({ target, message }, options) => {
        try {
            const sender = collabBinding(options)
            const receiver = sender.control.sendMessage(sender, target, nonEmptyMessage(message), true)
            return textResult(JSON.stringify({ target: receiver.agentPath, triggered: true }, null, 2))
        } catch (error) {
            return toolFailure('followup_task', error)
        }
    },
})

export const waitAgentTool = tool({
    description: 'Wait for mailbox activity. Child result content is delivered separately to the next model request.',
    inputSchema: WAIT_AGENT_INPUT_SCHEMA,
    metadata: collabMetadata,
    execute: async ({ timeout_ms }, options) => {
        const timeoutMs = timeout_ms ?? DEFAULT_WAIT_TIMEOUT_MS
        if (timeoutMs < MIN_WAIT_TIMEOUT_MS || timeoutMs > MAX_WAIT_TIMEOUT_MS) {
            return textResult(
                `wait_agent failed: timeout_ms must be between ${MIN_WAIT_TIMEOUT_MS} and ${MAX_WAIT_TIMEOUT_MS}`,
                true,
            )
        }
        try {
            const sender = collabBinding(options)
            const activity = await sender.control.waitForActivity(sender, timeoutMs, options.abortSignal)
            const timedOut = activity === 'timeout'
            const message =
                activity === 'mailbox'
                    ? 'Wait completed.'
                    : activity === 'aborted'
                      ? 'Wait interrupted by cancellation.'
                      : activity === 'closed'
                        ? 'Agent mailbox closed.'
                        : 'Wait timed out.'
            return textResult(JSON.stringify({ message, timed_out: timedOut }, null, 2))
        } catch (error) {
            return toolFailure('wait_agent', error)
        }
    },
})

export const interruptAgentTool = tool({
    description: 'Interrupt an agent current turn while keeping the agent available for follow-up work.',
    inputSchema: TARGET_INPUT_SCHEMA,
    metadata: collabMetadata,
    execute: async ({ target }, options) => {
        try {
            const sender = collabBinding(options)
            const receiver = sender.control.interruptAgent(sender, target)
            return textResult(
                JSON.stringify(
                    {
                        agent_id: receiver.agentId,
                        agent_path: receiver.agentPath,
                        previous_status: receiver.status,
                    },
                    null,
                    2,
                ),
            )
        } catch (error) {
            return toolFailure('interrupt_agent', error)
        }
    },
})

export const listAgentsTool = tool({
    description: 'List live sub-agents in the current agent subtree.',
    inputSchema: LIST_AGENTS_INPUT_SCHEMA,
    metadata: collabMetadata,
    execute: async ({ path_prefix }, options) => {
        try {
            const sender = collabBinding(options)
            const agents = sender.control.listAgents(sender, path_prefix).map(compactAgent)
            return textResult(JSON.stringify({ agents }, null, 2))
        } catch (error) {
            return toolFailure('list_agents', error)
        }
    },
})
