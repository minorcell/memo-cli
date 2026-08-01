import type { RuntimeStatus } from '../../shared/types'

export const COMPOSER_COLOR = {
    disabled: 'gray',
    idle: 'cyan',
    running: 'yellow',
    thinking: '#e6a23c',
} as const

export type ComposerColorParams = {
    disabled: boolean
    operationStatus: RuntimeStatus
    thinkingOn: boolean
}

/**
 * Picks the composer border/prompt/cursor color.
 *
 * Priority: disabled > transient running states > thinking > idle.
 * - disabled: gray
 * - running/cancelling/awaiting_approval/compacting: yellow (busy is transient and wins over mode color)
 * - idle + thinking on: amber (distinct from idle cyan and busy yellow)
 * - idle: cyan
 */
export function resolveComposerColor({ disabled, operationStatus, thinkingOn }: ComposerColorParams): string {
    if (disabled) return COMPOSER_COLOR.disabled
    if (operationStatus !== 'idle') return COMPOSER_COLOR.running
    return thinkingOn ? COMPOSER_COLOR.thinking : COMPOSER_COLOR.idle
}
