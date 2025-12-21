import { Box, Text } from 'ink'
import type { TurnView as TurnViewType } from '../types'
import { StepView } from './StepView'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'

type TurnViewProps = {
    turn: TurnViewType
}

export function TurnView({ turn }: TurnViewProps) {
    const lastStepText = turn.steps[turn.steps.length - 1]?.assistantText?.trim() ?? ''
    const finalText = turn.finalText?.trim() ?? ''
    const shouldRenderFinal = finalText.length > 0 && finalText !== lastStepText

    return (
        <Box flexDirection="column" gap={1}>
            <UserMessage text={turn.userInput} />
            {turn.steps.map((step) => (
                <StepView key={`step-${turn.index}-${step.index}`} step={step} />
            ))}
            {shouldRenderFinal ? <AssistantMessage text={finalText} /> : null}
            {turn.status && turn.status !== 'ok' ? (
                <Text color="red">Status: {turn.status}</Text>
            ) : null}
        </Box>
    )
}
