import { Box, Text } from 'ink'

type HeaderBarProps = {
    sessionId: string
    providerName: string
    model: string
    streamOutput: boolean
}

export function HeaderBar({
    sessionId,
    providerName,
    model,
    streamOutput,
}: HeaderBarProps) {
    return (
        <Box justifyContent="space-between">
            <Text color="cyan">memo-cli</Text>
            <Text color="gray">session:{sessionId}</Text>
            <Text>
                {providerName}:{model}
            </Text>
            <Text color={streamOutput ? 'green' : 'gray'}>
                stream:{streamOutput ? 'on' : 'off'}
            </Text>
        </Box>
    )
}
