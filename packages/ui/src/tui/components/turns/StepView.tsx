import { Box, Text } from 'ink'
import type { StepView as StepViewType } from '../../types'
import { safeStringify, stripToolCallArtifacts } from '../../utils'
import { AssistantMessage } from '../messages/AssistantMessage'

type StepViewProps = {
    step: StepViewType
}

export function StepView({ step }: StepViewProps) {
    const assistantText = step.action
        ? stripToolCallArtifacts(step.assistantText)
        : step.assistantText
    const shouldRenderAssistant = assistantText.trim().length > 0
    return (
        <Box flexDirection="column">
            {shouldRenderAssistant ? <AssistantMessage text={assistantText} /> : null}
            {step.action ? (
                <Box flexDirection="column" marginLeft={2}>
                    <Text color="yellow">
                        Tool: {step.action.tool} [{step.toolStatus ?? 'pending'}]
                    </Text>
                    <Text color="gray">params: {safeStringify(step.action.input ?? {})}</Text>
                </Box>
            ) : null}
        </Box>
    )
}
