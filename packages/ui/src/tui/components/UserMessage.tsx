import { Box, Text } from 'ink'
import { PREFIX_GLYPH } from '../constants'

type UserMessageProps = {
    text: string
}

export function UserMessage({ text }: UserMessageProps) {
    return (
        <Box>
            <Text color="gray">{PREFIX_GLYPH} </Text>
            <Text>{text}</Text>
        </Box>
    )
}
