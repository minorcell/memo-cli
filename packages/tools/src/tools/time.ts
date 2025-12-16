import { z } from 'zod'
import type { McpTool } from '@memo/tools/tools/types'
import { textResult } from '@memo/tools/tools/mcp'

const TIME_INPUT_SCHEMA = z.object({}).strict()

type TimeInput = z.infer<typeof TIME_INPUT_SCHEMA>

function pad(value: number, length = 2) {
    return String(value).padStart(length, '0')
}

function formatOffset(minutes: number) {
    const sign = minutes >= 0 ? '+' : '-'
    const absMinutes = Math.abs(minutes)
    const hours = pad(Math.floor(absMinutes / 60))
    const mins = pad(absMinutes % 60)
    return `${sign}${hours}:${mins}`
}

function formatLocalIso(date: Date, offsetMinutes: number) {
    const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    return `${datePart}T${timePart}${formatOffset(offsetMinutes)}`
}

function formatDate(date: Date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatTime(date: Date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** time: 返回当前系统时间（ISO/UTC/epoch/timezone 等多视图）。 */
export const timeTool: McpTool<TimeInput> = {
    name: 'time',
    description: '返回当前系统时间（ISO/UTC/epoch/timezone 等多视图）',
    inputSchema: TIME_INPUT_SCHEMA,
    execute: async () => {
        const now = new Date()
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
        const offsetMinutes = -now.getTimezoneOffset()
        const offsetText = formatOffset(offsetMinutes)
        const isoLocal = formatLocalIso(now, offsetMinutes)
        const isoUtc = now.toISOString()
        const epochMs = now.getTime()
        const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now)
        const humanReadable = `${formatDate(now)} ${formatTime(now)} (${weekday}, UTC${offsetText} ${timezone})`

        const payload = {
            iso: isoLocal,
            utc_iso: isoUtc,
            epoch_ms: epochMs,
            epoch_seconds: Math.floor(epochMs / 1000),
            timezone: {
                name: timezone,
                offset_minutes: offsetMinutes,
                offset: offsetText,
            },
            day_of_week: weekday,
            human_readable: humanReadable,
            source: 'local_system_clock',
        }

        return textResult(JSON.stringify(payload))
    },
}
