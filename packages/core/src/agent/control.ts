import { randomUUID } from 'node:crypto'
import type { AgentActivity, AgentSession, HistoryEvent, HistorySink } from '@memo/core/types'
import { InputQueue, type InterAgentCommunication } from './communication'
import { buildForkHistory, buildSubagentSystemPrompt, parseForkTurns } from './fork'
import { AgentRegistry, ExecutionLimiter, ROOT_AGENT_PATH, agentPathDepth, type AgentMetadata } from './registry'
import { AgentRuntime } from './runtime'
import { deriveAgentStatusFromEvent, isFinalAgentStatus } from './status'

export type CollabSessionBinding = {
    agentId: string
    agentPath: string
    inputQueue: InputQueue
    control: AgentControl
}

export type CreateSubagentParams = {
    sessionId: string
    agentPath: string
    initialHistory: AgentSession['history']
    systemPrompt: string
    binding: CollabSessionBinding
    statusSink: HistorySink
}

export type AgentControlOptions = {
    rootSessionId: string
    rootSystemPrompt: string
    rootHistorySinks: HistorySink[]
    createSubagent: (params: CreateSubagentParams) => Promise<AgentSession>
    onAgentActivity?: (activity: AgentActivity) => void
    maxRunningTurns?: number
    maxDepth?: number
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export class AgentControl {
    private readonly registry = new AgentRegistry()
    private readonly bindings = new Map<string, CollabSessionBinding>()
    private readonly sessions = new Map<string, AgentSession>()
    private readonly runtimes = new Map<string, AgentRuntime>()
    private readonly limiter: ExecutionLimiter
    private readonly maxDepth: number
    private shuttingDown = false

    constructor(private readonly options: AgentControlOptions) {
        this.maxDepth = options.maxDepth ?? parsePositiveInteger(process.env.MEMO_SUBAGENT_MAX_DEPTH, 3)
        const maxRunning = options.maxRunningTurns ?? parsePositiveInteger(process.env.MEMO_SUBAGENT_MAX_AGENTS, 4)
        this.limiter = new ExecutionLimiter(maxRunning, () => {
            queueMicrotask(() => this.wakePendingAgents())
        })
        this.registry.registerRoot(options.rootSessionId)
    }

    createRootBinding(): CollabSessionBinding {
        const existing = this.bindings.get(this.options.rootSessionId)
        if (existing) return existing
        const binding: CollabSessionBinding = {
            agentId: this.options.rootSessionId,
            agentPath: ROOT_AGENT_PATH,
            inputQueue: new InputQueue(),
            control: this,
        }
        this.bindings.set(binding.agentId, binding)
        return binding
    }

    attachRootSession(session: AgentSession): void {
        this.sessions.set(this.options.rootSessionId, session)
    }

    async spawnAgent(
        sender: CollabSessionBinding,
        params: { message: string; taskName: string; forkTurns?: string },
    ): Promise<AgentMetadata> {
        if (this.shuttingDown) throw new Error('agent tree is shutting down')
        const parentSession = this.sessions.get(sender.agentId)
        if (!parentSession) throw new Error(`parent agent is not loaded: ${sender.agentPath}`)

        const reservation = this.registry.reserve(sender.agentPath, params.taskName, this.maxDepth)
        const permit = this.limiter.tryAcquire()
        if (!permit) {
            reservation.release()
            throw new Error('subagent concurrency limit reached')
        }

        const agentId = randomUUID()
        const binding: CollabSessionBinding = {
            agentId,
            agentPath: reservation.agentPath,
            inputQueue: new InputQueue(),
            control: this,
        }
        const systemPrompt = buildSubagentSystemPrompt(this.options.rootSystemPrompt, binding.agentPath)
        let session: AgentSession | undefined
        try {
            const initialHistory = buildForkHistory(
                parentSession.history,
                systemPrompt,
                parseForkTurns(params.forkTurns),
            )
            const statusSink: HistorySink = {
                append: (event) => this.handleAgentEvent(agentId, event),
            }
            session = await this.options.createSubagent({
                sessionId: agentId,
                agentPath: binding.agentPath,
                initialHistory,
                systemPrompt,
                binding,
                statusSink,
            })
            const metadata: AgentMetadata = {
                agentId,
                agentPath: binding.agentPath,
                taskName: params.taskName.trim(),
                parentId: sender.agentId,
                parentPath: sender.agentPath,
                status: 'pending_init',
                updatedAt: new Date().toISOString(),
            }
            this.registry.register(metadata, reservation)
            this.bindings.set(agentId, binding)
            this.sessions.set(agentId, session)
            const runtime = new AgentRuntime(session, binding.inputQueue, this.limiter, (error) => {
                void this.recordUnexpectedError(agentId, error)
            })
            this.runtimes.set(agentId, runtime)
            await this.publishActivity(metadata)
            runtime.deliverWithPermit(
                {
                    author: sender.agentPath,
                    recipient: binding.agentPath,
                    content: params.message,
                    triggerTurn: true,
                },
                permit,
            )
            return metadata
        } catch (error) {
            permit.release()
            reservation.release()
            if (session) await session.close().catch(() => {})
            this.runtimes.delete(agentId)
            this.sessions.delete(agentId)
            this.bindings.delete(agentId)
            this.registry.remove(agentId)
            throw error
        }
    }

    sendMessage(sender: CollabSessionBinding, target: string, content: string, triggerTurn: boolean): AgentMetadata {
        const receiver = this.resolveTarget(target, sender.agentPath)
        if (triggerTurn && receiver.agentPath === ROOT_AGENT_PATH) {
            throw new Error('follow-up tasks cannot target the root agent')
        }
        const communication: InterAgentCommunication = {
            author: sender.agentPath,
            recipient: receiver.agentPath,
            content,
            triggerTurn,
        }
        const runtime = this.runtimes.get(receiver.agentId)
        if (runtime) runtime.deliver(communication)
        else this.bindings.get(receiver.agentId)?.inputQueue.enqueue(communication)
        return receiver
    }

    async waitForActivity(binding: CollabSessionBinding, timeoutMs: number, signal?: AbortSignal) {
        return binding.inputQueue.waitForActivity(timeoutMs, signal)
    }

    interruptAgent(sender: CollabSessionBinding, target: string): AgentMetadata {
        const receiver = this.resolveTarget(target, sender.agentPath)
        if (receiver.agentPath === ROOT_AGENT_PATH) throw new Error('root is not a spawned agent')
        if (receiver.agentId === sender.agentId) throw new Error('an agent cannot interrupt itself')
        this.runtimes.get(receiver.agentId)?.interrupt()
        return receiver
    }

    listAgents(sender: CollabSessionBinding, pathPrefix?: string): AgentMetadata[] {
        let prefix = sender.agentPath
        if (pathPrefix) {
            prefix = pathPrefix.startsWith('/') ? pathPrefix : `${sender.agentPath}/${pathPrefix}`
        }
        return this.registry.list(prefix)
    }

    async shutdownDescendants(rootAgentId: string): Promise<void> {
        if (rootAgentId !== this.options.rootSessionId || this.shuttingDown) return
        this.shuttingDown = true
        const descendants = this.registry
            .list(ROOT_AGENT_PATH)
            .sort((left, right) => agentPathDepth(right.agentPath) - agentPathDepth(left.agentPath))
        for (const agent of descendants) {
            await this.runtimes.get(agent.agentId)?.shutdown()
            this.runtimes.delete(agent.agentId)
            this.sessions.delete(agent.agentId)
            this.bindings.delete(agent.agentId)
            this.registry.remove(agent.agentId)
        }
        this.bindings.get(rootAgentId)?.inputQueue.close()
    }

    private resolveTarget(target: string, senderPath: string): AgentMetadata {
        const receiver = this.registry.resolve(target.trim(), senderPath)
        if (!receiver) throw new Error(`agent not found: ${target}`)
        return receiver
    }

    private wakePendingAgents(): void {
        if (this.shuttingDown) return
        for (const runtime of this.runtimes.values()) {
            runtime.wakePending()
        }
    }

    private async handleAgentEvent(agentId: string, event: HistoryEvent): Promise<void> {
        const current = this.registry.getById(agentId)
        if (!current) return
        const nextStatus = deriveAgentStatusFromEvent(current, event)
        const contextPercent =
            event.type === 'context_usage' && typeof event.meta?.usage_percent === 'number'
                ? event.meta.usage_percent
                : undefined
        const updated = this.registry.update(agentId, {
            ...nextStatus,
            ...(contextPercent === undefined ? {} : { contextPercent }),
        })
        if (!updated) return

        if (
            event.type === 'turn_start' ||
            event.type === 'context_usage' ||
            event.type === 'turn_end' ||
            event.type === 'session_end'
        ) {
            await this.publishActivity(updated)
        }

        if (event.type !== 'turn_end' || !isFinalAgentStatus(updated.status) || this.shuttingDown) return
        this.notifyParentOfFinal(updated)
    }

    private notifyParentOfFinal(updated: AgentMetadata): void {
        const parent = updated.parentId ? this.bindings.get(updated.parentId) : undefined
        if (!parent) return
        const detail = updated.error ?? updated.lastMessage ?? ''
        parent.inputQueue.enqueue({
            author: updated.agentPath,
            recipient: parent.agentPath,
            content: `<agent_completion path="${updated.agentPath}" status="${updated.status}">\n${detail}\n</agent_completion>`,
            triggerTurn: false,
        })
    }

    private async recordUnexpectedError(agentId: string, error: Error): Promise<void> {
        const updated = this.registry.update(agentId, { status: 'errored', error: error.message })
        if (!updated) return
        await this.publishActivity(updated)
        if (!this.shuttingDown) this.notifyParentOfFinal(updated)
    }

    private async publishActivity(metadata: AgentMetadata): Promise<void> {
        const activity: AgentActivity = {
            agentId: metadata.agentId,
            agentPath: metadata.agentPath,
            taskName: metadata.taskName,
            parentId: metadata.parentId,
            status: metadata.status,
            contextPercent: metadata.contextPercent,
            lastMessage: metadata.lastMessage,
            error: metadata.error,
            updatedAt: metadata.updatedAt,
        }
        try {
            this.options.onAgentActivity?.(activity)
        } catch {
            // UI callbacks must not change agent lifecycle behavior.
        }
        const event: HistoryEvent = {
            ts: new Date().toISOString(),
            sessionId: this.options.rootSessionId,
            type: 'agent_status',
            content: activity.lastMessage,
            meta: {
                agent_id: activity.agentId,
                agent_path: activity.agentPath,
                task_name: activity.taskName,
                parent_id: activity.parentId,
                status: activity.status,
                context_percent: activity.contextPercent,
                error: activity.error,
                updated_at: activity.updatedAt,
            },
        }
        await Promise.allSettled(this.options.rootHistorySinks.map((sink) => sink.append(event)))
    }
}
