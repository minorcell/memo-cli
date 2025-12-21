import { Box } from 'ink'
import type { SystemMessage, TurnView as TurnViewType } from '../types'
import { SystemMessageView } from './SystemMessageView'
import { TurnView } from './TurnView'
import { StatusMessage } from './StatusMessage'

type MainContentProps = {
    systemMessages: SystemMessage[]
    turns: TurnViewType[]
    statusText: string
    statusKind: 'initializing' | 'running' | 'ready' | 'error'
}

export function MainContent({
    systemMessages,
    turns,
    statusText,
    statusKind,
}: MainContentProps) {
    return (
        <Box flexDirection="column" gap={1}>
            {systemMessages.map((message) => (
                <SystemMessageView key={message.id} message={message} />
            ))}
            {turns.map((turn) => (
                <TurnView key={`turn-${turn.index}`} turn={turn} />
            ))}
            <StatusMessage text={statusText} kind={statusKind} />
        </Box>
    )
}
