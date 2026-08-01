import stringWidth from 'string-width'

export type TextPreview = {
    text: string
    truncated: boolean
}

type PreviewOptions = {
    columns: number
    maxLines: number
    from?: 'start' | 'end'
}

function wrapText(input: string, columns: number): string[] {
    const lines: string[] = []
    let chars: string[] = []
    let width = 0
    let lastWhitespaceIndex = -1

    const flush = () => {
        lines.push(chars.join(''))
        chars = []
        width = 0
        lastWhitespaceIndex = -1
    }

    for (const char of input) {
        if (char === '\n') {
            flush()
            continue
        }

        const charWidth = Math.max(0, stringWidth(char))
        if (chars.length > 0 && width + charWidth > columns) {
            if (lastWhitespaceIndex >= 0) {
                lines.push(chars.slice(0, lastWhitespaceIndex).join('').trimEnd())
                chars = chars.slice(lastWhitespaceIndex + 1)
                while (chars[0] && /\s/.test(chars[0])) chars.shift()
                width = stringWidth(chars.join(''))
                lastWhitespaceIndex = chars.findLastIndex((value) => /\s/.test(value))
            } else {
                flush()
            }
        }
        chars.push(char)
        width += charWidth
        if (/\s/.test(char)) lastWhitespaceIndex = chars.length - 1
    }
    lines.push(chars.join(''))
    return lines
}

function addEndEllipsis(line: string, columns: number): string {
    const suffix = '…'
    const available = Math.max(0, columns - stringWidth(suffix))
    let text = ''
    let width = 0

    for (const char of line) {
        const charWidth = Math.max(0, stringWidth(char))
        if (width + charWidth > available) break
        text += char
        width += charWidth
    }
    return `${text}${suffix}`
}

function addStartEllipsis(line: string, columns: number): string {
    const prefix = '…'
    const available = Math.max(0, columns - stringWidth(prefix))
    let text = ''
    let width = 0

    for (const char of Array.from(line).reverse()) {
        const charWidth = Math.max(0, stringWidth(char))
        if (width + charWidth > available) break
        text = `${char}${text}`
        width += charWidth
    }
    return `${prefix}${text}`
}

export function previewText(input: string, options: PreviewOptions): TextPreview {
    const value = input.replace(/\r\n?/g, '\n').trim()
    if (!value) return { text: '', truncated: false }

    const columns = Math.max(1, Math.floor(options.columns))
    const maxLines = Math.max(1, Math.floor(options.maxLines))
    const lines = wrapText(value, columns)
    if (lines.length <= maxLines) return { text: value, truncated: false }

    if (options.from === 'end' && maxLines === 1) {
        return {
            text: addStartEllipsis(value.replace(/\s+/g, ' '), columns),
            truncated: true,
        }
    }

    if (options.from === 'end') {
        return {
            text: ['…', ...lines.slice(-(maxLines - 1))].join('\n'),
            truncated: true,
        }
    }

    const visible = lines.slice(0, maxLines)
    visible[visible.length - 1] = addEndEllipsis(visible[visible.length - 1] ?? '', columns)
    return { text: visible.join('\n'), truncated: true }
}
