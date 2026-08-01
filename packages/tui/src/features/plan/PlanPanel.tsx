import { memo } from 'react'
import { Box, Text } from 'ink'
import { planProgress, type PlanItemStatus, type PlanView } from './planState'

function itemPresentation(status: PlanItemStatus): { glyph: string; color: string; dimColor: boolean } {
    if (status === 'completed') return { glyph: '✓', color: 'gray', dimColor: true }
    if (status === 'in_progress') return { glyph: '›', color: 'yellow', dimColor: false }
    return { glyph: '○', color: 'gray', dimColor: false }
}

export const PlanPanel = memo(function PlanPanel({ plan }: { plan: PlanView }) {
    const progress = planProgress(plan)

    return (
        <Box
            flexDirection="column"
            marginTop={1}
            paddingLeft={1}
            borderStyle="single"
            borderTop={false}
            borderRight={false}
            borderBottom={false}
            borderColor="gray"
            borderDimColor
        >
            <Box justifyContent="space-between">
                <Text bold color="cyan">
                    Plan
                </Text>
                <Text color="gray" dimColor>
                    {progress.completed}/{progress.total}
                </Text>
            </Box>

            {plan.explanation ? (
                <Text color="gray" dimColor wrap="wrap">
                    {plan.explanation}
                </Text>
            ) : null}

            <Box flexDirection="column" marginTop={plan.explanation ? 1 : 0}>
                {plan.items.map((item, index) => {
                    const presentation = itemPresentation(item.status)
                    return (
                        <Box key={`${index}-${item.step}`}>
                            <Text color={presentation.color} dimColor={presentation.dimColor}>
                                {presentation.glyph}{' '}
                            </Text>
                            <Box flexShrink={1}>
                                <Text color={presentation.color} dimColor={presentation.dimColor} wrap="wrap">
                                    {item.step}
                                </Text>
                            </Box>
                        </Box>
                    )
                })}
            </Box>
        </Box>
    )
})
