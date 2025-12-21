import { Box, Text, useInput, useStdout } from 'ink'
import { useState } from 'react'
import { USER_PREFIX } from '../constants'
import { buildPaddedLine } from '../utils'

type InputPromptProps = {
    disabled: boolean
    onSubmit: (value: string) => void
    onExit: () => void
    onClear: () => void
    history: string[]
}

export function InputPrompt({
    disabled,
    onSubmit,
    onExit,
    onClear,
    history,
}: InputPromptProps) {
    const { stdout } = useStdout()
    const [value, setValue] = useState('')
    const [historyIndex, setHistoryIndex] = useState<number | null>(null)
    const [draft, setDraft] = useState('')

    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            onExit()
            return
        }
        if (key.ctrl && input === 'l') {
            setValue('')
            setHistoryIndex(null)
            setDraft('')
            onClear()
            return
        }

        if (disabled) {
            return
        }

        if (key.return) {
            const trimmed = value.trim()
            if (trimmed) {
                onSubmit(trimmed)
                setValue('')
                setHistoryIndex(null)
                setDraft('')
            }
            return
        }

        if (key.upArrow) {
            if (!history.length) return
            if (historyIndex === null) {
                setDraft(value)
                const nextIndex = history.length - 1
                setHistoryIndex(nextIndex)
                setValue(history[nextIndex] ?? '')
                return
            }
            const nextIndex = Math.max(0, historyIndex - 1)
            setHistoryIndex(nextIndex)
            setValue(history[nextIndex] ?? '')
            return
        }

        if (key.downArrow) {
            if (historyIndex === null) return
            const nextIndex = historyIndex + 1
            if (nextIndex >= history.length) {
                setHistoryIndex(null)
                setValue(draft)
                setDraft('')
                return
            }
            setHistoryIndex(nextIndex)
            setValue(history[nextIndex] ?? '')
            return
        }

        if (key.backspace || key.delete) {
            setValue((prev) => prev.slice(0, Math.max(0, prev.length - 1)))
            return
        }

        if (input) {
            setValue((prev) => prev + input)
        }
    })

    const placeholder = disabled ? 'Running...' : 'Input...'
    const displayText = value || placeholder
    const lineColor = value && !disabled ? 'white' : 'gray'
    const { line, blankLine } = buildPaddedLine(
        `${USER_PREFIX} ${displayText}`,
        stdout?.columns ?? 80,
        1,
    )
    const verticalPadding = 1

    return (
        <Box flexDirection="column">
            {verticalPadding > 0 ? (
                <Text backgroundColor="#2b2b2b">{blankLine}</Text>
            ) : null}
            <Text color={lineColor} backgroundColor="#2b2b2b">
                {line}
            </Text>
            {verticalPadding > 0 ? (
                <Text backgroundColor="#2b2b2b">{blankLine}</Text>
            ) : null}
        </Box>
    )
}
