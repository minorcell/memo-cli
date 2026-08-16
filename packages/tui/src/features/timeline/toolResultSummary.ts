import { TOOL_STATUS, type ToolResultView } from '../../shared/types'
import { looksLikePathInput, toRelativeDisplayPath } from '../../shared/lib/utils'
import { previewText } from './contentPreview'

const MAX_RESULT_LINES = 3

function meaningfulLines(observation: string): string[] {
    return observation
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0)
}

function fitLine(line: string, columns: number): string {
    return previewText(line, { columns: Math.max(1, columns), maxLines: 1 }).text
}

function tailSummary(lines: string[], columns: number): string[] {
    if (lines.length <= MAX_RESULT_LINES) return lines.map((line) => fitLine(line, columns))

    const visibleCount = MAX_RESULT_LINES - 1
    const omittedCount = lines.length - visibleCount
    return [
        fitLine(`… ${omittedCount} earlier lines`, columns),
        ...lines.slice(-visibleCount).map((line) => fitLine(line, columns)),
    ]
}

function searchSummary(lines: string[], cwd: string, columns: number): string[] {
    if (lines.length === 1 && lines[0] === 'No matches found') return lines

    const displayLines = lines.map((line) => (looksLikePathInput(line) ? toRelativeDisplayPath(line, cwd) : line))
    if (displayLines.length <= MAX_RESULT_LINES) {
        return displayLines.map((line) => fitLine(line, columns))
    }

    const visibleCount = MAX_RESULT_LINES - 1
    return [
        ...displayLines.slice(0, visibleCount).map((line) => fitLine(line, columns)),
        fitLine(`+ ${displayLines.length - visibleCount} more`, columns),
    ]
}

export function summarizeToolResult(result: ToolResultView, cwd: string, columns: number): string[] {
    const lines = meaningfulLines(result.observation)
    if (result.status === TOOL_STATUS.ERROR) return tailSummary(lines, columns)

    if (result.tool === 'read') return []
    if (result.tool === 'list_directory') return [`${lines.length} ${lines.length === 1 ? 'entry' : 'entries'}`]
    if (result.tool === 'search_files') return searchSummary(lines, cwd, columns)

    return tailSummary(lines, columns)
}
