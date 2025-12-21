import { Box, Text } from 'ink'
import type { TurnView as TurnViewType } from '../types'
import { StepView } from './StepView'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'

type TurnViewProps = {
    turn: TurnViewType
    showDuration?: boolean
}

export function TurnView({ turn, showDuration = false }: TurnViewProps) {
    const lastStepText = turn.steps[turn.steps.length - 1]?.assistantText?.trim() ?? ''
    const finalText = turn.finalText?.trim() ?? ''
    const shouldRenderFinal = finalText.length > 0 && finalText !== lastStepText
    const durationSeconds =
        typeof turn.durationMs === 'number'
            ? Math.max(1, Math.round(turn.durationMs / 1000))
            : null
    const shouldShowDuration = showDuration && durationSeconds !== null

    return (
        <Box flexDirection="column" gap={1}>
            <UserMessage text={turn.userInput} />
            {turn.steps.map((step) => (
                <StepView key={`step-${turn.index}-${step.index}`} step={step} />
            ))}
            {shouldShowDuration ? (
                <Text color="gray">— Worked for {durationSeconds}s —</Text>
            ) : null}
            {shouldRenderFinal ? <AssistantMessage text={finalText} /> : null}
            {turn.status && turn.status !== 'ok' ? (
                <Text color="red">Status: {turn.status}</Text>
            ) : null}
        </Box>
    )
}
