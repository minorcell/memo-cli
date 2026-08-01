import assert from 'node:assert'
import { describe, test } from 'vitest'
import { TOOL_STATUS, type ToolResultView, type TurnView } from '../../shared/types'
import { parsePlanUpdateObservation, planProgress, planStateReducer, type PlanItemStatus } from './planState'

function observation(statuses: PlanItemStatus[], explanation = 'Work through the task'): string {
    return JSON.stringify({
        message: 'Plan updated',
        explanation,
        plan: statuses.map((status, index) => ({ step: `step ${index + 1}`, status })),
    })
}

function result(observationText: string, status: ToolResultView['status'] = TOOL_STATUS.SUCCESS): ToolResultView {
    return {
        toolCallId: 'plan-call',
        tool: 'update_plan',
        observation: observationText,
        status,
    }
}

describe('plan state', () => {
    test('parses a successful update_plan observation', () => {
        const plan = parsePlanUpdateObservation(
            observation(['completed', 'in_progress', 'pending', 'pending'], '  Next phase  '),
        )

        assert.ok(plan)
        assert.strictEqual(plan.explanation, 'Next phase')
        assert.deepStrictEqual(planProgress(plan), { completed: 1, total: 4 })
    })

    test('ignores rejected and unrelated tool results', () => {
        const active = parsePlanUpdateObservation(observation(['in_progress', 'pending', 'pending', 'pending']))
        assert.ok(active)

        const simpleTask = result('<system_hint tool="update_plan" reason="simple_task">Skip it.</system_hint>')
        assert.strictEqual(planStateReducer(active, { type: 'tool_result', result: simpleTask }), active)
        assert.strictEqual(
            planStateReducer(active, {
                type: 'tool_result',
                result: { ...result('failed', TOOL_STATUS.ERROR), observation: 'invalid plan' },
            }),
            active,
        )
        assert.strictEqual(
            planStateReducer(active, {
                type: 'tool_result',
                result: { ...result('ignored'), tool: 'exec_command' },
            }),
            active,
        )
    })

    test('hides the plan when every item is completed', () => {
        const state = planStateReducer(null, {
            type: 'tool_result',
            result: result(observation(['completed', 'completed', 'completed', 'completed'])),
        })

        assert.strictEqual(state, null)
    })

    test('restores the latest active plan from history', () => {
        const turns: TurnView[] = [
            {
                index: 1,
                userInput: 'do work',
                steps: [
                    {
                        index: 0,
                        assistantText: '',
                        toolResults: [result(observation(['completed', 'in_progress', 'pending', 'pending']))],
                    },
                    {
                        index: 1,
                        assistantText: '',
                        toolResults: [
                            result(observation(['completed', 'completed', 'in_progress', 'pending'], 'Latest phase')),
                        ],
                    },
                ],
            },
        ]

        const restored = planStateReducer(null, { type: 'restore_history', turns })
        assert.ok(restored)
        assert.strictEqual(restored.explanation, 'Latest phase')
        assert.deepStrictEqual(planProgress(restored), { completed: 2, total: 4 })
    })
})
