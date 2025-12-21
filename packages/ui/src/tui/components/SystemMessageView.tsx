import { Box, Text } from 'ink'
import type { SystemMessage } from '../types'

type SystemMessageViewProps = {
    message: SystemMessage
}

export function SystemMessageView({ message }: SystemMessageViewProps) {
    return (
        <Box flexDirection="column">
            <Text color="magenta">System: {message.title}</Text>
            <Text>{message.content}</Text>
        </Box>
    )
}
