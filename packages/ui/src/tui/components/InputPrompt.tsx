import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

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

    return (
        <Box>
            <Text color={disabled ? 'gray' : 'green'}>{'> '}</Text>
            {value ? (
                <Text>{value}</Text>
            ) : (
                <Text color="gray">{disabled ? 'Running...' : 'Input...'}</Text>
            )}
        </Box>
    )
}
