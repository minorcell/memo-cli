type KeyLike = {
    backspace?: boolean
    delete?: boolean
    ctrl?: boolean
    meta?: boolean
}

export type DeleteKind = 'none' | 'backspace' | 'delete'

const ASCII_BS = '\u0008'
const ASCII_DEL = '\u007f'

export function resolveDeleteKind(input: string, key: KeyLike): DeleteKind {
    const isBackspaceChar = input === ASCII_BS || input === ASCII_DEL
    const isCtrlHBackspace = Boolean(key.ctrl) && input.toLowerCase() === 'h'

    if (Boolean(key.backspace) || isBackspaceChar || isCtrlHBackspace) {
        return 'backspace'
    }

    // Ink v5 parses many terminal Backspace events (\x7f) as key.delete.
    // The `useInput` hook then normalizes non-alphanumeric key input to ''.
    // Because we cannot distinguish physical Backspace from Forward Delete
    // in this shape, prefer Backspace semantics for ergonomic behavior.
    if (Boolean(key.delete) && !(key.ctrl || key.meta)) {
        return 'backspace'
    }

    if (key.delete) {
        return 'delete'
    }

    return 'none'
}

export type ModifiedEnterKind = 'newline' | 'ignore' | 'none'

const MODIFIED_ENTER_PATTERN = /^\u001b\[27;\d+;(\d+)~$/

/**
 * Recognizes Enter variants that Ink's parser does not map to `key.return`,
 * such as xterm modifyOtherKeys (`\x1b[27;2;13~` for Shift+Enter). Unknown
 * escape sequences must not reach the editor as raw text (that renders as
 * garbage), so anything unrecognized starting with ESC is ignored.
 */
export function resolveModifiedEnter(input: string): ModifiedEnterKind {
    if (!input.startsWith('\u001b')) return 'none'
    const match = MODIFIED_ENTER_PATTERN.exec(input)
    if (match && match[1] === '13') return 'newline'
    return 'ignore'
}
