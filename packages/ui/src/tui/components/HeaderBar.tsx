import { Box, Text } from 'ink'
import os from 'node:os'

type HeaderBarProps = {
    providerName: string
    model: string
    cwd: string
}

function formatCwd(cwd: string) {
    const home = os.homedir()
    if (!home) return cwd
    return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
}

export function HeaderBar({ providerName, model, cwd }: HeaderBarProps) {
    const displayCwd = formatCwd(cwd)
    return (
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
            <Box>
                <Text color="white">{'> Memo CLI'}</Text>
                <Text color="gray"> (local)</Text>
            </Box>
            <Box>
                <Text color="gray">model: </Text>
                <Text bold>{model}</Text>
                <Text color="gray">  provider: </Text>
                <Text>{providerName}</Text>
                <Text color="gray">  /config to view</Text>
            </Box>
            <Box>
                <Text color="gray">directory: </Text>
                <Text>{displayCwd}</Text>
            </Box>
        </Box>
    )
}
