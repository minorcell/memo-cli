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
