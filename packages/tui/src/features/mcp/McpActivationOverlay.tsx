import { memo, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { MultiSelect, type Option } from '@inkjs/ui'

type McpActivationOverlayProps = {
    serverNames: string[]
    defaultSelected: string[]
    onConfirm: (selectedServerNames: string[], persistSelection: boolean) => void
}

function normalizeSelected(serverNames: string[], selected: string[]) {
    const allowed = new Set(serverNames)
    return selected.filter((name) => allowed.has(name))
}

export const McpActivationOverlay = memo(function McpActivationOverlay({
    serverNames,
    defaultSelected,
    onConfirm,
}: McpActivationOverlayProps) {
    const initialSelection = useMemo(() => {
        const normalized = normalizeSelected(serverNames, defaultSelected)
        if (defaultSelected.length === 0) return []
        return normalized.length > 0 ? normalized : [...serverNames]
    }, [defaultSelected, serverNames])

    const [selectedNames, setSelectedNames] = useState<string[]>(initialSelection)
    const allSelected = selectedNames.length === serverNames.length

    // Note: Ctrl+C is handled by Ink's built-in exit (session cleanup runs on
    // unmount); only Esc needs custom handling here.
    useInput((_input, key) => {
        if (key.escape) {
            onConfirm(selectedNames, false)
        }
    })

    return (
        <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
            <Text bold color="cyan">
                Activate MCP Servers
            </Text>
            <Text color="gray">Select servers to load for this run.</Text>
            <Box marginTop={1} flexDirection="column">
                <MultiSelect
                    options={serverNames.map((name): Option => ({ label: name, value: name }))}
                    defaultValue={initialSelection}
                    onChange={setSelectedNames}
                    onSubmit={(value) => {
                        onConfirm(value, true)
                    }}
                />
            </Box>
            <Box marginTop={1} flexDirection="column">
                <Text color="gray">
                    Selected: {selectedNames.length}/{serverNames.length}
                    {allSelected ? ' (all)' : ''}
                </Text>
                <Text color="gray">Controls: ↑/↓ move, Space toggle, Enter confirm</Text>
            </Box>
        </Box>
    )
})
