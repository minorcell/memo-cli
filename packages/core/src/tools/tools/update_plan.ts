import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'

const PLAN_ITEM_SCHEMA = z
    .object({
        step: z.string().min(1),
        status: z.enum(['pending', 'in_progress', 'completed']),
    })
    .strict()

const UPDATE_PLAN_INPUT_SCHEMA = z
    .object({
        explanation: z.string().optional(),
        plan: z.array(PLAN_ITEM_SCHEMA).min(1),
    })
    .strict()

let currentPlan: UpdatePlanInput['plan'] = []

export const updatePlanTool = tool({
    description: 'Updates the task plan. At most one step can be in_progress at a time.',
    inputSchema: UPDATE_PLAN_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: false, isMutating: false } },

    execute: async ({ explanation, plan }) => {
        const inProgressCount = plan.filter((item) => item.status === 'in_progress').length
        if (inProgressCount > 1) {
            return textResult('At most one step can be in_progress at a time', true)
        }

        if (plan.length < 4) {
            const step = plan[0]?.step ?? ''
            return textResult(
                `<system_hint tool="update_plan" reason="simple_task">Task "${step}" is simple (${plan.length} step${plan.length > 1 ? 's' : ''}) - execute directly without update_plan.</system_hint>`,
            )
        }

        currentPlan = plan

        return textResult(
            JSON.stringify(
                {
                    message: 'Plan updated',
                    explanation,
                    plan: currentPlan,
                },
                null,
                2,
            ),
        )
    },
})
