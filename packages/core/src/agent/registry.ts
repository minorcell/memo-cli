import type { AgentStatusSnapshot } from '@memo/core/agent/status'

export const ROOT_AGENT_PATH = '/root'

export type AgentMetadata = AgentStatusSnapshot & {
    agentId: string
    agentPath: string
    taskName: string
    parentId?: string
    parentPath?: string
    contextPercent?: number
    updatedAt: string
}

export function agentPathDepth(path: string): number {
    if (path === ROOT_AGENT_PATH) return 0
    return path.split('/').filter(Boolean).length - 1
}

export function joinAgentPath(parentPath: string, taskName: string): string {
    return `${parentPath}/${taskName}`
}

export function validateTaskName(taskName: string): string {
    const normalized = taskName.trim()
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(normalized)) {
        throw new Error('task_name must contain only letters, numbers, underscores, or hyphens')
    }
    return normalized
}

export class SpawnReservation {
    private active = true

    constructor(
        readonly agentPath: string,
        private releaseReservation: () => void,
    ) {}

    commit(): void {
        this.active = false
    }

    release(): void {
        if (!this.active) return
        this.active = false
        this.releaseReservation()
    }
}

export class AgentRegistry {
    private byId = new Map<string, AgentMetadata>()
    private byPath = new Map<string, string>()
    private reservedPaths = new Set<string>()

    registerRoot(agentId: string): void {
        const now = new Date().toISOString()
        const root: AgentMetadata = {
            agentId,
            agentPath: ROOT_AGENT_PATH,
            taskName: 'root',
            status: 'completed',
            updatedAt: now,
        }
        this.byId.set(agentId, root)
        this.byPath.set(ROOT_AGENT_PATH, agentId)
    }

    reserve(parentPath: string, taskName: string, maxDepth: number): SpawnReservation {
        const normalized = validateTaskName(taskName)
        const path = joinAgentPath(parentPath, normalized)
        if (agentPathDepth(path) > maxDepth) {
            throw new Error(`subagent depth limit reached (${maxDepth})`)
        }
        if (this.byPath.has(path) || this.reservedPaths.has(path)) {
            throw new Error(`agent path already exists: ${path}`)
        }
        this.reservedPaths.add(path)
        return new SpawnReservation(path, () => this.reservedPaths.delete(path))
    }

    register(metadata: AgentMetadata, reservation: SpawnReservation): void {
        if (reservation.agentPath !== metadata.agentPath || this.byPath.has(metadata.agentPath)) {
            throw new Error(`agent path already exists: ${metadata.agentPath}`)
        }
        this.reservedPaths.delete(metadata.agentPath)
        this.byId.set(metadata.agentId, metadata)
        this.byPath.set(metadata.agentPath, metadata.agentId)
        reservation.commit()
    }

    getById(agentId: string): AgentMetadata | undefined {
        return this.byId.get(agentId)
    }

    getByPath(agentPath: string): AgentMetadata | undefined {
        const id = this.byPath.get(agentPath)
        return id ? this.byId.get(id) : undefined
    }

    resolve(target: string, senderPath: string): AgentMetadata | undefined {
        const direct = this.getById(target)
        if (direct) return direct
        if (target.startsWith('/')) return this.getByPath(target)
        return this.getByPath(joinAgentPath(senderPath, target)) ?? this.getByPath(`${ROOT_AGENT_PATH}/${target}`)
    }

    update(
        agentId: string,
        update: Partial<AgentStatusSnapshot> & { contextPercent?: number },
    ): AgentMetadata | undefined {
        const current = this.byId.get(agentId)
        if (!current) return undefined
        const next = { ...current, ...update, updatedAt: new Date().toISOString() }
        this.byId.set(agentId, next)
        return next
    }

    list(pathPrefix = ROOT_AGENT_PATH): AgentMetadata[] {
        return [...this.byId.values()]
            .filter((agent) => agent.agentPath !== ROOT_AGENT_PATH)
            .filter((agent) => agent.agentPath === pathPrefix || agent.agentPath.startsWith(`${pathPrefix}/`))
            .sort((left, right) => left.agentPath.localeCompare(right.agentPath))
    }

    remove(agentId: string): void {
        const metadata = this.byId.get(agentId)
        if (!metadata || metadata.agentPath === ROOT_AGENT_PATH) return
        this.byId.delete(agentId)
        this.byPath.delete(metadata.agentPath)
    }
}

export type ExecutionPermit = { release: () => void }

export class ExecutionLimiter {
    private active = 0

    constructor(
        private readonly capacity: number,
        private readonly onRelease?: () => void,
    ) {}

    tryAcquire(): ExecutionPermit | null {
        if (this.active >= this.capacity) return null
        this.active += 1
        let released = false
        return {
            release: () => {
                if (released) return
                released = true
                this.active -= 1
                this.onRelease?.()
            },
        }
    }

    get activeCount(): number {
        return this.active
    }
}
