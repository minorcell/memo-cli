import { Box, Text } from 'ink'
import type { StepView as StepViewType } from '../types'
import { safeStringify } from '../utils'
import { AssistantMessage } from './AssistantMessage'

type StepViewProps = {
    step: StepViewType
}

export function StepView({ step }: StepViewProps) {
    return (
        <Box flexDirection="column">
            {step.assistantText ? <AssistantMessage text={step.assistantText} /> : null}
            {step.action ? (
                <Box flexDirection="column" marginTop={1} marginLeft={2}>
                    <Text color="yellow">
                        Tool: {step.action.tool} [{step.toolStatus ?? 'pending'}]
                    </Text>
                    <Text color="gray">input: {safeStringify(step.action.input)}</Text>
                    {step.observation ? (
                        <Text color={step.toolStatus === 'error' ? 'red' : 'yellow'}>
                            output: {step.observation}
                        </Text>
                    ) : null}
                </Box>
            ) : null}
        </Box>
    )
}
