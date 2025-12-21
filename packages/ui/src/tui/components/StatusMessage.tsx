import { Box, Text } from 'ink'
import { useEffect, useState } from 'react'
import { PREFIX_GLYPH } from '../constants'

type StatusMessageProps = {
    text: string
    kind: 'initializing' | 'running' | 'ready' | 'error'
}

const STATUS_COLOR: Record<StatusMessageProps['kind'], string> = {
    initializing: 'gray',
    running: 'yellow',
    ready: 'green',
    error: 'red',
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function useSpinner(active: boolean) {
    const [index, setIndex] = useState(0)
    useEffect(() => {
        if (!active) return
        const timer = setInterval(() => {
            setIndex((prev) => (prev + 1) % SPINNER_FRAMES.length)
        }, 80)
        return () => clearInterval(timer)
    }, [active])
    return SPINNER_FRAMES[index] ?? SPINNER_FRAMES[0]
}

export function StatusMessage({ text, kind }: StatusMessageProps) {
    const spinner = useSpinner(kind === 'running')
    const icon = kind === 'running' ? spinner : PREFIX_GLYPH
    return (
        <Box>
            <Text color={STATUS_COLOR[kind]}>
                {icon} <Text color="gray">{text}</Text>
            </Text>
        </Box>
    )
}
