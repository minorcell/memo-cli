/** @file Built-in tool registry */
import type { NativeTool, ToolRegistry } from '../types'

/** Built-in tool registry */
export class NativeToolRegistry {
    private tools: Map<string, NativeTool> = new Map()

    /** Register a single tool */
    register(tool: NativeTool): void {
        this.tools.set(tool.name, tool)
    }

    /** Register multiple tools in batch */
    registerMany(tools: NativeTool[]): void {
        for (const tool of tools) {
            this.register(tool)
        }
    }

    /** Get tool */
    get(name: string): NativeTool | undefined {
        return this.tools.get(name)
    }

    /** Get all tools */
    getAll(): NativeTool[] {
        return Array.from(this.tools.values())
    }

    /** Convert to ToolRegistry format */
    toRegistry(): ToolRegistry {
        const registry: ToolRegistry = {}
        for (const [name, tool] of this.tools) {
            registry[name] = tool
        }
        return registry
    }

    /** Check if tool exists */
    has(name: string): boolean {
        return this.tools.has(name)
    }

    /** Get tool count */
    get size(): number {
        return this.tools.size
    }
}
