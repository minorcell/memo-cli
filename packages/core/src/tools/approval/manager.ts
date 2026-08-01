/** @file Approval manager implementation */

import type {
    ApprovalManager,
    ApprovalManagerConfig,
    ApprovalKey,
    ApprovalDecision,
    ApprovalCheckResult,
    RiskLevel,
} from './types'
import { createToolClassifier } from './classifier'
import { generateFingerprint } from './fingerprint'
import { ALWAYS_AUTO_APPROVE_TOOLS } from './constants'

interface ApprovalCache {
    sessionTools: Set<string>
    onceTools: Set<string>
    deniedTools: Set<string>
    toolByFingerprint: Map<ApprovalKey, string>
}

function buildApprovalReason(toolName: string): string {
    return `Tool "${toolName}" requires approval.`
}

export function createApprovalManager(config?: ApprovalManagerConfig): ApprovalManager {
    const { mode = 'auto', dangerous = false, toolRiskLevels } = config || {}
    const approvalMode = mode === 'strict' ? 'strict' : 'auto'

    if (dangerous) {
        return {
            isDangerousMode: true,
            getRiskLevel: () => 'read',
            check: () => ({ needApproval: false, decision: 'auto-execute' }),
            recordDecision: () => {},
            isGranted: () => true,
            clearOnceApprovals: () => {},
            dispose: () => {},
        }
    }

    const classifier = createToolClassifier({ customLevels: toolRiskLevels })

    const cache: ApprovalCache = {
        sessionTools: new Set(),
        onceTools: new Set(),
        deniedTools: new Set(),
        toolByFingerprint: new Map(),
    }

    return {
        get isDangerousMode() {
            return false
        },

        getRiskLevel(toolName: string): RiskLevel {
            return classifier.getRiskLevel(toolName)
        },

        check(toolName: string, params: unknown): ApprovalCheckResult {
            if (ALWAYS_AUTO_APPROVE_TOOLS.has(toolName)) {
                return { needApproval: false, decision: 'auto-execute' }
            }

            const riskLevel = classifier.getRiskLevel(toolName)

            if (!classifier.needsApproval(riskLevel, approvalMode)) {
                return { needApproval: false, decision: 'auto-execute' }
            }

            const fingerprint = generateFingerprint(toolName, params)
            cache.toolByFingerprint.set(fingerprint, toolName)

            if (cache.sessionTools.has(toolName) || cache.onceTools.has(toolName)) {
                return { needApproval: false, decision: 'auto-execute' }
            }

            if (cache.deniedTools.has(toolName)) {
                return {
                    needApproval: true,
                    fingerprint,
                    riskLevel,
                    reason: 'This request was previously denied.',
                    toolName,
                    params,
                }
            }

            return {
                needApproval: true,
                fingerprint,
                riskLevel,
                reason: buildApprovalReason(toolName),
                toolName,
                params,
            }
        },

        recordDecision(fingerprint: ApprovalKey, decision: ApprovalDecision): void {
            const toolName = cache.toolByFingerprint.get(fingerprint)
            if (!toolName) return

            cache.sessionTools.delete(toolName)
            cache.onceTools.delete(toolName)
            cache.deniedTools.delete(toolName)

            switch (decision) {
                case 'session':
                    cache.sessionTools.add(toolName)
                    break
                case 'once':
                    cache.onceTools.add(toolName)
                    break
                case 'deny':
                    cache.deniedTools.add(toolName)
                    break
            }
        },

        isGranted(fingerprint: ApprovalKey): boolean {
            const toolName = cache.toolByFingerprint.get(fingerprint)
            if (!toolName) return false
            return cache.sessionTools.has(toolName) || cache.onceTools.has(toolName)
        },

        clearOnceApprovals(): void {
            cache.onceTools.clear()
        },

        dispose(): void {
            cache.sessionTools.clear()
            cache.onceTools.clear()
            cache.deniedTools.clear()
            cache.toolByFingerprint.clear()
        },
    }
}
