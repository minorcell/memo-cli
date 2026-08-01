/** @file Stable JSON serialization (deterministic key order, cycle-safe). */

/**
 * Stable serialization for duplicate action detection (ensures consistent key ordering).
 * Cycles are marked with `[Circular]`; values deeper than MAX_DEPTH with `[MaxDepthExceeded]`.
 */
export function stableStringify(value: unknown): string {
    return stableStringifyWithSeen(value, new WeakSet<object>(), 0)
}

const MAX_STABLE_STRINGIFY_DEPTH = 100

function stableStringifyWithSeen(value: unknown, seen: WeakSet<object>, depth: number): string {
    if (depth > MAX_STABLE_STRINGIFY_DEPTH) {
        return JSON.stringify('[MaxDepthExceeded]')
    }
    if (typeof value === 'bigint') {
        return JSON.stringify(value.toString())
    }
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
    if (seen.has(value)) {
        return JSON.stringify('[Circular]')
    }

    seen.add(value)
    if (Array.isArray(value)) {
        const result = `[${value.map((v) => stableStringifyWithSeen(v, seen, depth + 1)).join(',')}]`
        seen.delete(value)
        return result
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    const result = `{${entries
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringifyWithSeen(v, seen, depth + 1)}`)
        .join(',')}}`
    seen.delete(value)
    return result
}
