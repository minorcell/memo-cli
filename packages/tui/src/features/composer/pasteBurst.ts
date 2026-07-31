import { previousCursorIndex } from './composerInput'

const DEFAULT_MIN_CHARS = 3
const DEFAULT_CHAR_INTERVAL_MS = 8
const DEFAULT_ENTER_SUPPRESS_WINDOW_MS = 120
const DEFAULT_ACTIVE_IDLE_TIMEOUT_MS = process.platform === 'win32' ? 60 : 8

type PasteBurstOptions = {
    minChars?: number
    charIntervalMs?: number
    enterSuppressWindowMs?: number
    activeIdleTimeoutMs?: number
}

type PendingFirstChar = {
    ch: string
    atMs: number
}

export type PasteBurstCharDecision =
    | { type: 'begin_buffer'; retroChars: number }
    | { type: 'buffer_append' }
    | { type: 'retain_first_char' }
    | { type: 'begin_buffer_from_pending' }

export type PasteBurstFlushResult = { type: 'none' } | { type: 'paste'; text: string } | { type: 'typed'; text: string }

export type PasteBurstRetroGrab = {
    start: number
    grabbed: string
}

export class PasteBurst {
    private lastPlainCharAtMs: number | null = null
    private consecutivePlainChars = 0
    private burstWindowUntilMs: number | null = null
    private buffer = ''
    private active = false
    private pendingFirstChar: PendingFirstChar | null = null

    private readonly minChars: number
    private readonly charIntervalMs: number
    private readonly enterSuppressWindowMs: number
    private readonly activeIdleTimeoutMs: number

    constructor(options: PasteBurstOptions = {}) {
        this.minChars = options.minChars ?? DEFAULT_MIN_CHARS
        this.charIntervalMs = options.charIntervalMs ?? DEFAULT_CHAR_INTERVAL_MS
        this.enterSuppressWindowMs = options.enterSuppressWindowMs ?? DEFAULT_ENTER_SUPPRESS_WINDOW_MS
        this.activeIdleTimeoutMs = options.activeIdleTimeoutMs ?? DEFAULT_ACTIVE_IDLE_TIMEOUT_MS
    }

    static recommendedFlushDelayMs(): number {
        return DEFAULT_CHAR_INTERVAL_MS + 1
    }

    recommendedActiveFlushDelayMs(): number {
        return this.activeIdleTimeoutMs + 1
    }

    onPlainChar(ch: string, nowMs: number): PasteBurstCharDecision {
        const normalized = Array.from(ch)[0] ?? ''
        this.notePlainChar(nowMs)

        if (this.active) {
            this.extendWindow(nowMs)
            return { type: 'buffer_append' }
        }

        if (this.pendingFirstChar && nowMs - this.pendingFirstChar.atMs <= this.charIntervalMs) {
            this.active = true
            this.buffer += this.pendingFirstChar.ch
            this.pendingFirstChar = null
            this.extendWindow(nowMs)
            return { type: 'begin_buffer_from_pending' }
        }

        if (this.consecutivePlainChars >= this.minChars) {
            return {
                type: 'begin_buffer',
                retroChars: Math.max(0, this.consecutivePlainChars - 1),
            }
        }

        if (!normalized) {
            return { type: 'retain_first_char' }
        }
        this.pendingFirstChar = { ch: normalized, atMs: nowMs }
        return { type: 'retain_first_char' }
    }

    onPlainCharNoHold(nowMs: number): PasteBurstCharDecision | null {
        this.notePlainChar(nowMs)

        if (this.active) {
            this.extendWindow(nowMs)
            return { type: 'buffer_append' }
        }

        if (this.consecutivePlainChars >= this.minChars) {
            return {
                type: 'begin_buffer',
                retroChars: Math.max(0, this.consecutivePlainChars - 1),
            }
        }

        return null
    }

    flushIfDue(nowMs: number): PasteBurstFlushResult {
        const timeoutMs = this.isActiveInternal() ? this.activeIdleTimeoutMs : this.charIntervalMs
        const timedOut = this.lastPlainCharAtMs !== null && nowMs - this.lastPlainCharAtMs > timeoutMs

        if (!timedOut) return { type: 'none' }

        if (this.isActiveInternal()) {
            this.active = false
            const text = this.buffer
            this.buffer = ''
            return { type: 'paste', text }
        }

        if (this.pendingFirstChar) {
            const text = this.pendingFirstChar.ch
            this.pendingFirstChar = null
            return { type: 'typed', text }
        }

        return { type: 'none' }
    }

    appendNewlineIfActive(nowMs: number): boolean {
        if (!this.isActiveInternal()) return false
        this.buffer += '\n'
        this.extendWindow(nowMs)
        return true
    }

    newlineShouldInsertInsteadOfSubmit(nowMs: number): boolean {
        const inWindow = this.burstWindowUntilMs !== null && nowMs <= this.burstWindowUntilMs
        return this.isActiveInternal() || inWindow
    }

    extendWindow(nowMs: number): void {
        this.burstWindowUntilMs = nowMs + this.enterSuppressWindowMs
    }

    beginWithRetroGrabbed(grabbed: string, nowMs: number): void {
        if (grabbed) this.buffer += grabbed
        this.active = true
        this.extendWindow(nowMs)
    }

    appendCharToBuffer(ch: string, nowMs: number): void {
        if (!ch) return
        this.buffer += ch
        this.extendWindow(nowMs)
    }

    decideBeginBuffer(nowMs: number, before: string, retroChars: number): PasteBurstRetroGrab | null {
        const start = retroStartIndex(before, retroChars)
        const grabbed = before.slice(start)
        const looksPastey = /\s/u.test(grabbed) || Array.from(grabbed).length >= 16
        if (!looksPastey) return null

        this.beginWithRetroGrabbed(grabbed, nowMs)
        return { start, grabbed }
    }

    flushBeforeModifiedInput(): string | null {
        if (!this.isActive()) return null

        this.active = false
        let output = this.buffer
        this.buffer = ''

        if (this.pendingFirstChar) {
            output += this.pendingFirstChar.ch
            this.pendingFirstChar = null
        }

        return output
    }

    clearWindowAfterNonChar(): void {
        this.consecutivePlainChars = 0
        this.lastPlainCharAtMs = null
        this.burstWindowUntilMs = null
        this.active = false
        this.pendingFirstChar = null
    }

    isActive(): boolean {
        return this.isActiveInternal() || this.pendingFirstChar !== null
    }

    isBuffering(): boolean {
        return this.isActiveInternal()
    }

    hasPendingFirstChar(): boolean {
        return this.pendingFirstChar !== null
    }

    clearAfterExplicitPaste(): void {
        this.lastPlainCharAtMs = null
        this.consecutivePlainChars = 0
        this.burstWindowUntilMs = null
        this.active = false
        this.buffer = ''
        this.pendingFirstChar = null
    }

    private notePlainChar(nowMs: number): void {
        if (this.lastPlainCharAtMs !== null && nowMs - this.lastPlainCharAtMs <= this.charIntervalMs) {
            this.consecutivePlainChars += 1
        } else {
            this.consecutivePlainChars = 1
        }
        this.lastPlainCharAtMs = nowMs
    }

    private isActiveInternal(): boolean {
        return this.active || this.buffer.length > 0
    }
}

export function retroStartIndex(before: string, retroChars: number): number {
    if (retroChars <= 0) return before.length

    let cursor = before.length
    let remaining = retroChars
    while (remaining > 0 && cursor > 0) {
        cursor = previousCursorIndex(before, cursor)
        remaining -= 1
    }
    return cursor
}
