import { Box, Text } from 'ink'
import { Spinner, StatusMessage, TextInput } from '@inkjs/ui'
import { memo, useCallback, useMemo, useState } from 'react'
import { writeMemoConfig, type MemoConfig } from '@memo/core'

type SetupWizardProps = {
    configPath: string
    onComplete: () => void
}

type SetupStep = {
    key: 'name' | 'envKey' | 'model' | 'baseUrl'
    label: string
    hint?: string
    defaultValue: string
}

type SetupValues = {
    name: string
    envKey: string
    model: string
    baseUrl: string
}

const STEPS: SetupStep[] = [
    {
        key: 'name',
        label: 'Provider name',
        hint: 'Used for /models switching',
        defaultValue: 'deepseek',
    },
    {
        key: 'envKey',
        label: 'API key env var',
        hint: 'Read at runtime from environment variables',
        defaultValue: 'DEEPSEEK_API_KEY',
    },
    {
        key: 'model',
        label: 'Model name',
        defaultValue: 'deepseek-chat',
    },
    {
        key: 'baseUrl',
        label: 'Base URL',
        defaultValue: 'https://api.deepseek.com',
    },
]

export const SetupWizard = memo(function SetupWizard({ configPath, onComplete }: SetupWizardProps) {
    const [stepIndex, setStepIndex] = useState(0)
    const [values, setValues] = useState<Partial<SetupValues>>({})
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const step = STEPS[stepIndex] ?? STEPS[0]

    const saveConfig = useCallback(
        async (nextValues: SetupValues) => {
            setBusy(true)
            setError(null)
            try {
                const config: MemoConfig = {
                    current_provider: nextValues.name,
                    providers: [
                        {
                            name: nextValues.name,
                            env_api_key: nextValues.envKey,
                            model: nextValues.model,
                            base_url: nextValues.baseUrl || undefined,
                        },
                    ],
                }
                await writeMemoConfig(configPath, config)
                onComplete()
            } catch (err) {
                setError((err as Error).message)
                setBusy(false)
            }
        },
        [configPath, onComplete],
    )

    const commitCurrent = useCallback(
        async (submittedValue: string) => {
            if (!step) return
            const value = submittedValue.trim() || step.defaultValue
            const nextValues: Partial<SetupValues> = {
                ...values,
                [step.key]: value,
            }
            setValues(nextValues)
            if (stepIndex < STEPS.length - 1) {
                setStepIndex(stepIndex + 1)
                return
            }
            const completeValues: SetupValues = {
                name: nextValues.name || STEPS[0]!.defaultValue,
                envKey: nextValues.envKey || STEPS[1]!.defaultValue,
                model: nextValues.model || STEPS[2]!.defaultValue,
                baseUrl: nextValues.baseUrl || STEPS[3]!.defaultValue,
            }
            await saveConfig(completeValues)
        },
        [saveConfig, step, stepIndex, values],
    )

    // Note: Ctrl+C is handled by Ink's built-in exit, so no custom handling here.

    const progress = useMemo(() => `Step ${stepIndex + 1}/${STEPS.length}`, [stepIndex])

    if (!step) return null

    return (
        <Box flexDirection="column">
            <Text bold>Memo setup</Text>
            <Text color="gray">No provider config found. Complete setup to continue.</Text>
            <Text color="gray">Config path: {configPath}</Text>
            <Box marginTop={1} flexDirection="column">
                <Text color="cyan">{progress}</Text>
                <Text>{step.label}</Text>
                <Text color="gray">Default: {step.defaultValue}</Text>
                {step.hint ? <Text color="gray">{step.hint}</Text> : null}
            </Box>
            <Box marginTop={1}>
                <Text color="gray">{'> '}</Text>
                <TextInput
                    key={step.key}
                    isDisabled={busy}
                    defaultValue={values[step.key] ?? ''}
                    placeholder={step.defaultValue}
                    onSubmit={(value) => {
                        void commitCurrent(value)
                    }}
                />
            </Box>
            <Box marginTop={1}>
                <Text color="gray">Enter to continue, Ctrl+C to exit</Text>
            </Box>
            {busy ? (
                <Box marginTop={1}>
                    <Spinner label="Saving config..." />
                </Box>
            ) : null}
            {error ? (
                <Box marginTop={1}>
                    <StatusMessage variant="error">Failed to save config: {error}</StatusMessage>
                </Box>
            ) : null}
        </Box>
    )
})
