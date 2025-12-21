import { Box, Text } from 'ink'

type TokenBarProps = {
    tokenLine: string
}

export function TokenBar({ tokenLine }: TokenBarProps) {
    return (
        <Box justifyContent="flex-end">
            <Text color="gray">{tokenLine}</Text>
        </Box>
    )
}
