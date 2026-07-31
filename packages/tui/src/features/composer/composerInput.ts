import stringWidth from 'string-width'

export type EditorBuffer = {
    value: string
    cursor: number
}

export type CursorLayout = {
    lines: string[]
    row: number
    column: number
}

export type WrappedCursorLine = {
    text: string
    start: number
    end: number
}

export type WrappedCursorLayout = {
    lines: WrappedCursorLine[]
    row: number
    cursorInRow: number
}

export type VerticalCursorMove = {
    cursor: number
    preferredColumn: number
    changed: boolean
}

const SURROGATE_HIGH_MIN = 0xd800
const SURROGATE_HIGH_MAX = 0xdbff
const SURROGATE_LOW_MIN = 0xdc00
const SURROGATE_LOW_MAX = 0xdfff

function isHighSurrogate(value: number): boolean {
    return value >= SURROGATE_HIGH_MIN && value <= SURROGATE_HIGH_MAX
}

function isLowSurrogate(value: number): boolean {
    return value >= SURROGATE_LOW_MIN && value <= SURROGATE_LOW_MAX
}

export function clampCursorToBoundary(value: string, cursor: number): number {
    if (!Number.isFinite(cursor)) return 0
    if (cursor <= 0) return 0
    if (cursor >= value.length) return value.length
    if (value.length === 0) return 0

    const normalized = Math.floor(cursor)
    if (normalized <= 0) return 0
    if (normalized >= value.length) return value.length

    const current = value.charCodeAt(normalized)
    const previous = value.charCodeAt(normalized - 1)

    if (isLowSurrogate(current) && isHighSurrogate(previous)) {
        return normalized - 1
    }

    return normalized
}

export function nextCursorIndex(value: string, cursor: number): number {
    const safeCursor = clampCursorToBoundary(value, cursor)
    if (safeCursor >= value.length) return value.length

    const codePoint = value.codePointAt(safeCursor)
    if (codePoint === undefined) return Math.min(value.length, safeCursor + 1)
    return Math.min(value.length, safeCursor + (codePoint > 0xffff ? 2 : 1))
}

export function previousCursorIndex(value: string, cursor: number): number {
    const safeCursor = clampCursorToBoundary(value, cursor)
    if (safeCursor <= 0) return 0

    const previous = safeCursor - 1
    if (previous <= 0) return previous

    const currentCode = value.charCodeAt(previous)
    const beforeCode = value.charCodeAt(previous - 1)
    if (isLowSurrogate(currentCode) && isHighSurrogate(beforeCode)) {
        return previous - 1
    }

    return previous
}

function lineStart(value: string, cursor: number): number {
    const safeCursor = clampCursorToBoundary(value, cursor)
    const boundary = value.lastIndexOf('\n', Math.max(0, safeCursor - 1))
    return boundary === -1 ? 0 : boundary + 1
}

function lineEnd(value: string, cursor: number): number {
    const safeCursor = clampCursorToBoundary(value, cursor)
    const boundary = value.indexOf('\n', safeCursor)
    return boundary === -1 ? value.length : boundary
}

function isWordChar(char: string): boolean {
    return /[\p{L}\p{N}_]/u.test(char)
}

export function insertAtCursor(value: string, cursor: number, input: string): EditorBuffer {
    const safeCursor = clampCursorToBoundary(value, cursor)
    if (!input) {
        return { value, cursor: safeCursor }
    }

    // Normalize pasted line endings to avoid terminal carriage-return artifacts.
    const normalizedInput = input.replace(/\r\n?/g, '\n')
    if (!normalizedInput) {
        return { value, cursor: safeCursor }
    }

    const nextValue = `${value.slice(0, safeCursor)}${normalizedInput}${value.slice(safeCursor)}`
    return { value: nextValue, cursor: safeCursor + normalizedInput.length }
}

export function backspaceAtCursor(value: string, cursor: number): EditorBuffer {
    const safeCursor = clampCursorToBoundary(value, cursor)
    if (safeCursor <= 0) return { value, cursor: safeCursor }

    const start = previousCursorIndex(value, safeCursor)
    const nextValue = `${value.slice(0, start)}${value.slice(safeCursor)}`
    return { value: nextValue, cursor: start }
}

export function deleteAtCursor(value: string, cursor: number): EditorBuffer {
    const safeCursor = clampCursorToBoundary(value, cursor)
    if (safeCursor >= value.length) return { value, cursor: safeCursor }

    const end = nextCursorIndex(value, safeCursor)
    const nextValue = `${value.slice(0, safeCursor)}${value.slice(end)}`
    return { value: nextValue, cursor: safeCursor }
}

export function deleteWordBackwardAtCursor(value: string, cursor: number): EditorBuffer {
    const safeCursor = clampCursorToBoundary(value, cursor)
    if (safeCursor <= 0) return { value, cursor: safeCursor }

    let start = safeCursor

    while (start > 0) {
        const previous = previousCursorIndex(value, start)
        const char = value.slice(previous, start)
        if (char.trim().length > 0) break
        start = previous
    }

    while (start > 0) {
        const previous = previousCursorIndex(value, start)
        const char = value.slice(previous, start)
        if (!isWordChar(char)) break
        start = previous
    }

    if (start === safeCursor) {
        start = previousCursorIndex(value, safeCursor)
    }

    const nextValue = `${value.slice(0, start)}${value.slice(safeCursor)}`
    return { value: nextValue, cursor: start }
}

export function deleteToLineStart(value: string, cursor: number): EditorBuffer {
    const safeCursor = clampCursorToBoundary(value, cursor)
    const start = lineStart(value, safeCursor)
    if (start >= safeCursor) return { value, cursor: safeCursor }

    const nextValue = `${value.slice(0, start)}${value.slice(safeCursor)}`
    return { value: nextValue, cursor: start }
}

export function deleteToLineEnd(value: string, cursor: number): EditorBuffer {
    const safeCursor = clampCursorToBoundary(value, cursor)
    const end = lineEnd(value, safeCursor)
    if (end <= safeCursor) return { value, cursor: safeCursor }

    const nextValue = `${value.slice(0, safeCursor)}${value.slice(end)}`
    return { value: nextValue, cursor: safeCursor }
}

export function moveCursorLeft(value: string, cursor: number): number {
    return previousCursorIndex(value, cursor)
}

export function moveCursorRight(value: string, cursor: number): number {
    return nextCursorIndex(value, cursor)
}

export function moveCursorToLineStart(value: string, cursor: number): number {
    return lineStart(value, cursor)
}

export function moveCursorToLineEnd(value: string, cursor: number): number {
    return lineEnd(value, cursor)
}

export function moveCursorVertical(
    value: string,
    cursor: number,
    direction: 'up' | 'down',
    preferredColumn?: number,
): VerticalCursorMove {
    const safeCursor = clampCursorToBoundary(value, cursor)
    const currentStart = lineStart(value, safeCursor)
    const currentEnd = lineEnd(value, safeCursor)
    const currentColumn = safeCursor - currentStart
    const targetColumn = preferredColumn ?? currentColumn

    if (direction === 'up') {
        if (currentStart === 0) {
            return { cursor: safeCursor, preferredColumn: targetColumn, changed: false }
        }

        const previousEnd = currentStart - 1
        const previousStart = lineStart(value, previousEnd)
        const nextCursor = Math.min(previousStart + targetColumn, previousEnd)
        return {
            cursor: nextCursor,
            preferredColumn: targetColumn,
            changed: nextCursor !== safeCursor,
        }
    }

    if (currentEnd >= value.length) {
        return { cursor: safeCursor, preferredColumn: targetColumn, changed: false }
    }

    const nextStart = currentEnd + 1
    const nextEnd = lineEnd(value, nextStart)
    const nextCursor = Math.min(nextStart + targetColumn, nextEnd)
    return { cursor: nextCursor, preferredColumn: targetColumn, changed: nextCursor !== safeCursor }
}

export function getCursorLayout(value: string, cursor: number): CursorLayout {
    const safeCursor = clampCursorToBoundary(value, cursor)
    const lines = value.split('\n')

    if (lines.length === 0) {
        return {
            lines: [''],
            row: 0,
            column: 0,
        }
    }

    let remaining = safeCursor
    for (let row = 0; row < lines.length; row += 1) {
        const line = lines[row] ?? ''
        const lineLength = line.length
        if (remaining <= lineLength) {
            return { lines, row, column: remaining }
        }
        remaining -= lineLength + 1
    }

    const lastRow = Math.max(0, lines.length - 1)
    const lastColumn = (lines[lastRow] ?? '').length
    return { lines, row: lastRow, column: lastColumn }
}

export function getWrappedCursorLayout(value: string, cursor: number, columns: number): WrappedCursorLayout {
    const safeCursor = clampCursorToBoundary(value, cursor)
    const wrapColumns = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1

    const lines: WrappedCursorLine[] = []
    let segmentStart = 0
    let segmentEnd = 0
    let segmentText = ''
    let segmentWidth = 0

    const pushSegment = () => {
        lines.push({
            text: segmentText,
            start: segmentStart,
            end: segmentEnd,
        })
    }

    let index = 0
    for (const char of value) {
        const charStart = index
        index += char.length

        if (char === '\n') {
            segmentEnd = charStart
            pushSegment()
            segmentStart = index
            segmentEnd = index
            segmentText = ''
            segmentWidth = 0
            continue
        }

        const charWidth = Math.max(0, stringWidth(char))
        if (segmentText.length > 0 && segmentWidth + charWidth > wrapColumns) {
            pushSegment()
            segmentStart = charStart
            segmentEnd = charStart
            segmentText = ''
            segmentWidth = 0
        }

        segmentText += char
        segmentEnd = index
        segmentWidth += charWidth
    }
    pushSegment()

    if (lines.length === 0) {
        return {
            lines: [{ text: '', start: 0, end: 0 }],
            row: 0,
            cursorInRow: 0,
        }
    }

    let row = Math.max(0, lines.length - 1)
    let cursorInRow = (lines[row]?.text ?? '').length

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        if (!line) continue
        if (safeCursor < line.start) continue
        if (safeCursor <= line.end) {
            row = i
            cursorInRow = safeCursor - line.start
            break
        }
    }

    return {
        lines,
        row,
        cursorInRow,
    }
}
