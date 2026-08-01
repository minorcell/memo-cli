/** @file Tool risk classifier */

import type { RiskLevel } from './types'
import {
    AUTO_MODE_APPROVAL_RISKS,
    DEFAULT_TOOL_RISK_LEVELS,
    EXECUTE_RISK_KEYWORDS,
    READ_RISK_KEYWORDS,
    RISK_LEVEL_ORDER,
    WRITE_RISK_KEYWORDS,
} from './constants'

export interface ToolClassifier {
    /** Get tool risk level */
    getRiskLevel(toolName: string): RiskLevel

    /** Compare two risk levels */
    compareRisk(a: RiskLevel, b: RiskLevel): number

    /** Check if approval is needed */
    needsApproval(riskLevel: RiskLevel, mode: 'auto' | 'strict'): boolean
}

export interface ToolClassifierConfig {
    /** Custom tool risk level mapping */
    customLevels?: Record<string, RiskLevel>
}

/** Create tool risk classifier */
export function createToolClassifier(config?: ToolClassifierConfig): ToolClassifier {
    const riskLevels: Record<string, RiskLevel> = {
        ...DEFAULT_TOOL_RISK_LEVELS,
        ...config?.customLevels,
    }

    return {
        getRiskLevel(toolName: string): RiskLevel {
            if (toolName in riskLevels) {
                return riskLevels[toolName]!
            }

            const lowerName = toolName.toLowerCase()

            if (matchesAnyKeyword(lowerName, EXECUTE_RISK_KEYWORDS)) {
                return 'execute'
            }

            if (matchesAnyKeyword(lowerName, WRITE_RISK_KEYWORDS)) {
                return 'write'
            }

            if (matchesAnyKeyword(lowerName, READ_RISK_KEYWORDS)) {
                return 'read'
            }

            return 'write'
        },

        compareRisk(a: RiskLevel, b: RiskLevel): number {
            return RISK_LEVEL_ORDER[a] - RISK_LEVEL_ORDER[b]
        },

        needsApproval(riskLevel: RiskLevel, mode: 'auto' | 'strict'): boolean {
            if (mode === 'strict') {
                return true
            }

            return AUTO_MODE_APPROVAL_RISKS.has(riskLevel)
        },
    }
}

function matchesAnyKeyword(name: string, keywords: readonly string[]): boolean {
    return keywords.some((keyword) => name.includes(keyword))
}
