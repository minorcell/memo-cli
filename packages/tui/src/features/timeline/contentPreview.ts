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
    let line = ''
    let width = 0

    for (const char of input) {
        if (char === '\n') {
            lines.push(line)
            line = ''
            width = 0
            continue
        }

        const charWidth = Math.max(0, stringWidth(char))
        if (line && width + charWidth > columns) {
            lines.push(line)
            line = ''
            width = 0
        }
        line += char
        width += charWidth
    }
    lines.push(line)
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

export function previewText(input: string, options: PreviewOptions): TextPreview {
    const value = input.replace(/\r\n?/g, '\n').trim()
    if (!value) return { text: '', truncated: false }

    const columns = Math.max(1, Math.floor(options.columns))
    const maxLines = Math.max(1, Math.floor(options.maxLines))
    const lines = wrapText(value, columns)
    if (lines.length <= maxLines) return { text: value, truncated: false }

    if (options.from === 'end' && maxLines > 1) {
        return {
            text: ['…', ...lines.slice(-(maxLines - 1))].join('\n'),
            truncated: true,
        }
    }

    const visible = lines.slice(0, maxLines)
    visible[visible.length - 1] = addEndEllipsis(visible[visible.length - 1] ?? '', columns)
    return { text: visible.join('\n'), truncated: true }
}
