/** @file Tool request fingerprint generation */

import { createHash } from 'node:crypto'
import { stableStringify } from '@memo/core/utils/serialize'
import type { ApprovalKey } from './types'

/** Generate tool request fingerprint */
export function generateFingerprint(toolName: string, params: unknown): ApprovalKey {
    const normalized = stableStringify(params)
    const raw = `${toolName}:${normalized}`
    return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

/** Generate partial parameter fingerprint (for fuzzy matching) */
export function generatePartialFingerprint(toolName: string, params: unknown, keys: string[]): ApprovalKey {
    if (typeof params !== 'object' || params === null) {
        return generateFingerprint(toolName, params)
    }

    const filtered: Record<string, unknown> = {}
    for (const key of keys) {
        if (key in params) {
            filtered[key] = (params as Record<string, unknown>)[key]
        }
    }

    return generateFingerprint(toolName, filtered)
}
