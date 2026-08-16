import { Transform } from 'node:stream'

/**
 * Ink's key parser recognizes kitty-protocol sequences but not xterm
 * modifyOtherKeys (`ESC[27;<modifier>;<code>~`), which terminals like
 * iTerm2 send for Shift+Enter. Unrecognized bytes fall through to input
 * handlers as raw text and render as garbage in the editor.
 *
 * This transform sits in front of Ink's stdin and rewrites the Enter
 * variant into the kitty-protocol equivalent (`ESC[13;2u`), which Ink
 * parses as return+shift. Everything else passes through untouched.
 */

const KITTY_SHIFT_ENTER = '\u001b[13;2u'

const MODIFIED_ENTER_PREFIX = '\u001b[27;'
// Prefix match: trailing plain text after the sequence must pass through.
const MODIFIED_ENTER_PATTERN = /^\u001b\[27;(\d+);(\d+)~/

/** Buffered bytes that may still grow into a recognizable sequence. */
export type PendingBytes = string | null

export type PushResult = {
    /** Segments pushed separately, so a rewritten sequence stays its own
     * chunk: Ink parses at most one keypress per chunk. */
    emit: string[]
    pending: PendingBytes
}

const MAX_PENDING_BYTES = 16
// Long enough for split deliveries of one key sequence (PTY/ssh), short
// enough that a lone ESC keypress still feels immediate.
const FLUSH_AFTER_MS = 150

function matchModifiedEnter(buffer: string): { code: string; length: number } | null {
    const match = MODIFIED_ENTER_PATTERN.exec(buffer)
    if (!match) return null
    return { code: match[2] ?? '', length: match[0].length }
}

function emitModifiedEnter(buffer: string, match: { code: string; length: number }): string[] {
    const rest = buffer.slice(match.length)
    if (match.code !== '13') return [buffer]
    return [KITTY_SHIFT_ENTER, ...(rest ? [rest] : [])]
}

function couldCompleteModifiedEnter(buffer: string): boolean {
    if (buffer.length > MAX_PENDING_BYTES) return false
    // Progressive prefix match against ESC[27;<digits>;<digits>~.
    const candidates = [
        '\u001b',
        '\u001b[',
        '\u001b[2',
        '\u001b[27',
        '\u001b[27;',
    ]
    if (buffer.length <= candidates.length) {
        return candidates[buffer.length - 1] === buffer
    }
    if (!buffer.startsWith(MODIFIED_ENTER_PREFIX)) return false
    return /^\u001b\[27;\d*(;\d*)?~?$/.test(buffer)
}

export function pushChunk(pending: PendingBytes, chunk: string): PushResult {
    const buffer = (pending ?? '') + chunk

    if (pending !== null) {
        // Continue matching a sequence buffered from a previous chunk.
        const match = matchModifiedEnter(buffer)
        if (match) {
            return { emit: emitModifiedEnter(buffer, match), pending: null }
        }
        if (couldCompleteModifiedEnter(buffer)) {
            return { emit: [], pending: buffer }
        }
        return { emit: [buffer], pending: null }
    }

    // Escape sequences may start in the middle of a chunk; emit the plain
    // text before them immediately.
    const escIndex = buffer.indexOf('\u001b')
    if (escIndex === -1) {
        return { emit: [buffer], pending: null }
    }
    const prefix = buffer.slice(0, escIndex)
    const rest = buffer.slice(escIndex)
    const match = matchModifiedEnter(rest)
    if (match) {
        const rewritten = emitModifiedEnter(rest, match)
        const segments = prefix ? [prefix, ...rewritten] : rewritten
        return { emit: segments, pending: null }
    }
    if (couldCompleteModifiedEnter(rest)) {
        return { emit: prefix ? [prefix] : [], pending: rest }
    }
    return { emit: [buffer], pending: null }
}

/**
 * Replaces process.stdin with a patched readable stream, so pastel/ink
 * receive kitty-protocol bytes instead of modifyOtherKeys sequences.
 * Plain (non-TTY) mode is left untouched.
 */
export function patchStdinForModifiedKeys(): void {
    if (!process.stdin.isTTY) return

    const original = process.stdin
    let pending: PendingBytes = null
    let flushTimer: NodeJS.Timeout | null = null

    const flushPending = () => {
        if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
        }
        if (pending) {
            patched.push(pending)
            pending = null
        }
    }

    const patched = new Transform({
        // Segments yield the event loop between pushes, so Ink's readable
        // handler consumes each segment as its own chunk.
        transform(chunk: Buffer, _encoding, callback) {
            const result = pushChunk(pending, chunk.toString('utf8'))
            pending = result.pending
            const pushNext = (index: number) => {
                if (index >= result.emit.length) {
                    callback()
                    return
                }
                patched.push(Buffer.from(result.emit[index] ?? '', 'utf8'))
                if (index < result.emit.length - 1) {
                    setTimeout(() => pushNext(index + 1), 0)
                } else {
                    callback()
                }
            }
            pushNext(0)
            if (pending) {
                if (flushTimer) clearTimeout(flushTimer)
                flushTimer = setTimeout(flushPending, FLUSH_AFTER_MS)
            }
        },
        flush(callback) {
            flushPending()
            callback()
        },
    })
    // Ink checks isTTY and delegates raw-mode/lifetime calls to the stream.
    patched.isTTY = true
    patched.setRawMode = (mode: boolean) => original.setRawMode(mode)
    patched.ref = () => original.ref()
    patched.unref = () => original.unref()

    original.pipe(patched)

    Object.defineProperty(process, 'stdin', {
        value: patched,
        configurable: true,
        writable: true,
    })
}
