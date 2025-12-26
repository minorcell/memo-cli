import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { Box, Text, useInput, useStdout } from 'ink'
import {
    getFileSuggestions,
    getSessionLogDir,
    type InputHistoryEntry,
    type ProviderConfig,
} from '@memo/core'
import { USER_PREFIX } from '../../constants'
import { buildPaddedLine } from '../../utils'
import { SuggestionList, type SuggestionListItem } from '../input/SuggestionList'
import { SLASH_COMMANDS, type SlashCommand } from '../../slash'

const DOUBLE_ESC_WINDOW_MS = 400

type InputPromptProps = {
    disabled: boolean
    onSubmit: (value: string) => void
    onExit: () => void
    onClear: () => void
    onCancelRun: () => void
    onHistorySelect?: (entry: InputHistoryEntry) => void
    onModelSelect?: (provider: ProviderConfig) => void
    history: string[]
    cwd: string
    sessionsDir: string
    currentSessionFile?: string
    providers: ProviderConfig[]
}

type SuggestionMode = 'none' | 'file' | 'history' | 'slash' | 'model'

type SuggestionItem = SuggestionListItem & {
    value: string
    meta?: {
        isDir?: boolean
        slashCommand?: SlashCommand
        historyEntry?: InputHistoryEntry
        provider?: ProviderConfig
    }
}

type FileTrigger = { type: 'file'; query: string; tokenStart: number }
type HistoryTrigger = { type: 'history'; keyword: string }
type SlashTrigger = { type: 'slash'; keyword: string }
type ModelsTrigger = { type: 'models'; keyword: string }
type SuggestionTrigger = FileTrigger | HistoryTrigger | SlashTrigger | ModelsTrigger

export function InputPrompt({
    disabled,
    onSubmit,
    onExit,
    onClear,
    onCancelRun,
    onModelSelect,
    history,
    cwd,
    sessionsDir,
    currentSessionFile,
    onHistorySelect,
    providers,
}: InputPromptProps) {
    const { stdout } = useStdout()
    const [value, setValue] = useState('')
    const [historyIndex, setHistoryIndex] = useState<number | null>(null)
    const [draft, setDraft] = useState('')
    const [suggestionMode, setSuggestionMode] = useState<SuggestionMode>('none')
    const [suggestionItems, setSuggestionItems] = useState<SuggestionItem[]>([])
    const [activeIndex, setActiveIndex] = useState(0)
    const [loadingSuggestions, setLoadingSuggestions] = useState(false)
    const [suppressSuggestions, setSuppressSuggestions] = useState(false)
    const requestIdRef = useRef(0)
    const lastEscTimeRef = useRef(0)

    useEffect(() => {
        setSuppressSuggestions(false)
    }, [value])

    const trigger = useMemo<SuggestionTrigger | null>(() => {
        if (suppressSuggestions || disabled) return null
        return detectSuggestionTrigger(value)
    }, [disabled, suppressSuggestions, value])

    const closeSuggestions = useCallback(
        (suppress = true) => {
            if (suppress) {
                setSuppressSuggestions(true)
            }
            setSuggestionMode('none')
            setSuggestionItems([])
            setActiveIndex(0)
            setLoadingSuggestions(false)
        },
        [],
    )

    useEffect(() => {
        if (disabled) {
            closeSuggestions(false)
        }
    }, [disabled, closeSuggestions])

    useEffect(() => {
        if (!trigger) {
            setSuggestionMode('none')
            setSuggestionItems([])
            setActiveIndex(0)
            setLoadingSuggestions(false)
            return
        }
        let cancelled = false
        const requestId = ++requestIdRef.current
        setLoadingSuggestions(true)
        ;(async () => {
            try {
                if (trigger.type === 'file') {
                    const matches = await getFileSuggestions({
                        cwd,
                        query: trigger.query,
                        limit: 8,
                    })
                    if (cancelled || requestId !== requestIdRef.current) return
                    const mapped = matches.map((match) => {
                        const displayPath = match.isDir ? `${match.path}/` : match.path
                        return {
                            id: match.id,
                            title: displayPath,
                            kind: 'file' as const,
                            value: displayPath,
                            meta: { isDir: match.isDir },
                        }
                    })
                    setSuggestionMode('file')
                    setSuggestionItems(mapped)
                    setActiveIndex((prev) =>
                        mapped.length ? Math.min(prev, mapped.length - 1) : 0,
                    )
                    return
                }
                if (trigger.type === 'history') {
                    const entries = await loadSessionHistoryEntries({
                        sessionsDir,
                        cwd,
                        keyword: trigger.keyword,
                        activeSessionFile: currentSessionFile,
                    })
                    if (cancelled || requestId !== requestIdRef.current) return
                    const mapped = entries.map(mapHistoryEntry)
                    setSuggestionMode('history')
                    setSuggestionItems(mapped)
                    setActiveIndex((prev) =>
                        mapped.length ? Math.min(prev, mapped.length - 1) : 0,
                    )
                    return
                }
                if (trigger.type === 'models') {
                    const keyword = trigger.keyword.toLowerCase()
                    const filtered = (providers ?? []).filter((p) => {
                        const name = p.name?.toLowerCase() ?? ''
                        const model = p.model?.toLowerCase() ?? ''
                        if (!keyword) return true
                        return name.includes(keyword) || model.includes(keyword)
                    })
                    const mapped = filtered.map((provider) => ({
                        id: provider.name,
                        title: `${provider.name}: ${provider.model}`,
                        subtitle: provider.base_url ?? provider.env_api_key ?? '',
                        kind: 'model' as const,
                        value: `/models ${provider.name}`,
                        meta: { provider },
                    }))
                    setSuggestionMode('model')
                    setSuggestionItems(mapped)
                    setActiveIndex((prev) =>
                        mapped.length ? Math.min(prev, mapped.length - 1) : 0,
                    )
                    return
                }
                if (trigger.type === 'slash') {
                    const keyword = trigger.keyword.toLowerCase()
                    const filtered = keyword
                        ? SLASH_COMMANDS.filter((cmd) =>
                              cmd.matches ? cmd.matches(keyword) : cmd.name.startsWith(keyword),
                          )
                        : SLASH_COMMANDS
                    const mapped = filtered.map((cmd) => ({
                        id: cmd.name,
                        title: `/${cmd.name}`,
                        subtitle: cmd.description,
                        kind: 'slash' as const,
                        value: `/${cmd.name} `,
                        meta: { slashCommand: cmd },
                    }))
                    setSuggestionMode('slash')
                    setSuggestionItems(mapped)
                    setActiveIndex((prev) =>
                        mapped.length ? Math.min(prev, mapped.length - 1) : 0,
                    )
                    return
                }
            } catch {
                if (!cancelled && requestId === requestIdRef.current) {
                    setSuggestionItems([])
                }
            } finally {
                if (!cancelled && requestId === requestIdRef.current) {
                    setLoadingSuggestions(false)
                }
            }
        })()
        return () => {
            cancelled = true
        }
    }, [trigger, cwd, sessionsDir, currentSessionFile, providers])

    const applySuggestion = useCallback(
        (item?: SuggestionItem) => {
            if (!item) return
            if (suggestionMode === 'file' && trigger?.type === 'file') {
                const prefix = value.slice(0, trigger.tokenStart)
                const suffix = value.slice(trigger.tokenStart + trigger.query.length)
                const nextValue = `${prefix}${item.value}${suffix}`
                setValue(nextValue)
                setHistoryIndex(null)
                setDraft('')
                if (!item.meta?.isDir) {
                    closeSuggestions()
                }
                return
            }
            if (suggestionMode === 'history') {
                if (item.meta?.historyEntry) {
                    onHistorySelect?.(item.meta.historyEntry)
                }
                setValue(item.value)
                setHistoryIndex(null)
                setDraft('')
                closeSuggestions()
                return
            }
            if (suggestionMode === 'slash' && item.meta?.slashCommand) {
                const slashCommand = item.meta.slashCommand
                slashCommand.run({
                    setInputValue: (next) => {
                        setValue(next)
                        setHistoryIndex(null)
                        setDraft('')
                    },
                    closeSuggestions,
                    clearScreen: () => {
                        onClear()
                    },
                    exitApp: () => {
                        onExit()
                    },
                })
                return
            }
            if (suggestionMode === 'model' && item.meta?.provider) {
                void onModelSelect?.(item.meta.provider)
                setValue('')
                setHistoryIndex(null)
                setDraft('')
                closeSuggestions()
                return
            }
        },
        [closeSuggestions, onClear, onExit, onModelSelect, suggestionMode, trigger, value],
    )

    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            onExit()
            return
        }
        if (key.ctrl && input === 'l') {
            setValue('')
            setHistoryIndex(null)
            setDraft('')
            closeSuggestions()
            onClear()
            return
        }

        const hasSuggestionList = suggestionMode !== 'none'
        const canNavigate = hasSuggestionList && suggestionItems.length > 0

        if (key.escape) {
            const now = Date.now()
            if (now - lastEscTimeRef.current <= DOUBLE_ESC_WINDOW_MS) {
                lastEscTimeRef.current = 0
                if (disabled) {
                    onCancelRun()
                } else {
                    setValue('')
                    setHistoryIndex(null)
                    setDraft('')
                    closeSuggestions()
                }
                return
            }
            lastEscTimeRef.current = now
            if (hasSuggestionList) {
                closeSuggestions()
            }
            return
        }

        if (disabled) {
            return
        }

        if (key.upArrow) {
            if (canNavigate) {
                setActiveIndex((prev) =>
                    prev <= 0 ? suggestionItems.length - 1 : prev - 1,
                )
                return
            }
            if (!history.length) return
            if (historyIndex === null) {
                setDraft(value)
                const nextIndex = history.length - 1
                setHistoryIndex(nextIndex)
                setValue(history[nextIndex] ?? '')
                return
            }
            const nextIndex = Math.max(0, historyIndex - 1)
            setHistoryIndex(nextIndex)
            setValue(history[nextIndex] ?? '')
            return
        }

        if (key.downArrow) {
            if (canNavigate) {
                setActiveIndex((prev) => (prev + 1) % suggestionItems.length)
                return
            }
            if (historyIndex === null) return
            const nextIndex = historyIndex + 1
            if (nextIndex >= history.length) {
                setHistoryIndex(null)
                setValue(draft)
                setDraft('')
                return
            }
            setHistoryIndex(nextIndex)
            setValue(history[nextIndex] ?? '')
            return
        }

        if (key.tab && canNavigate) {
            applySuggestion(suggestionItems[activeIndex])
            return
        }

        if (key.return) {
            if (canNavigate) {
                applySuggestion(suggestionItems[activeIndex])
                return
            }
            const trimmed = value.trim()
            if (trimmed) {
                onSubmit(trimmed)
                setValue('')
                setHistoryIndex(null)
                setDraft('')
                closeSuggestions(false)
            }
            return
        }

        if (key.backspace || key.delete) {
            setValue((prev) => prev.slice(0, Math.max(0, prev.length - 1)))
            return
        }

        if (input) {
            setValue((prev) => prev + input)
        }
    })

    const placeholder = disabled ? 'Running...' : 'Input...'
    const displayText = value || placeholder
    const lineColor = value && !disabled ? 'white' : 'gray'
    const { line, blankLine } = buildPaddedLine(
        `${USER_PREFIX} ${displayText}`,
        stdout?.columns ?? 80,
        1,
    )
    const verticalPadding = 1

    const suggestionListItems: SuggestionListItem[] = suggestionItems.map(
        ({ value: _value, meta: _meta, ...rest }) => rest,
    )

    return (
        <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
                {verticalPadding > 0 ? <Text backgroundColor="#2b2b2b">{blankLine}</Text> : null}
                <Text color={lineColor} backgroundColor="#2b2b2b">
                    {line}
                </Text>
                {verticalPadding > 0 ? <Text backgroundColor="#2b2b2b">{blankLine}</Text> : null}
            </Box>
            {suggestionMode !== 'none' ? (
                <SuggestionList
                    items={suggestionListItems}
                    activeIndex={activeIndex}
                    loading={loadingSuggestions}
                />
            ) : null}
        </Box>
    )
}

type HistoryLoadOptions = {
    sessionsDir: string
    cwd: string
    keyword?: string
    activeSessionFile?: string
    limit?: number
}

async function loadSessionHistoryEntries(options: HistoryLoadOptions): Promise<InputHistoryEntry[]> {
    const logDir = getSessionLogDir(options.sessionsDir, options.cwd)
    let dirEntries: import('node:fs').Dirent[]
    try {
        dirEntries = await readdir(logDir, { withFileTypes: true })
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
            return []
        }
        return []
    }
    const normalizedActive = options.activeSessionFile
        ? resolve(options.activeSessionFile)
        : null
    const candidates = await Promise.all(
        dirEntries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
            .map(async (entry) => {
                const fullPath = join(logDir, entry.name)
                if (normalizedActive && resolve(fullPath) === normalizedActive) {
                    return null
                }
                try {
                    const info = await stat(fullPath)
                    return { path: fullPath, mtimeMs: info.mtimeMs }
                } catch {
                    return null
                }
            }),
    )
    const sorted = candidates
        .filter((item): item is { path: string; mtimeMs: number } => Boolean(item))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
    const limit = options.limit ?? 10
    const keyword = options.keyword?.trim().toLowerCase()
    const entries: InputHistoryEntry[] = []
    for (const candidate of sorted) {
        if (entries.length >= limit) break
        const entry = await buildHistoryEntryFromFile(candidate.path, options.cwd, candidate.mtimeMs)
        if (!entry) continue
        if (keyword && !entry.input.toLowerCase().includes(keyword)) {
            continue
        }
        entries.push(entry)
        if (entries.length >= limit) break
    }
    return entries
}

async function buildHistoryEntryFromFile(
    filePath: string,
    cwd: string,
    ts: number,
): Promise<InputHistoryEntry | null> {
    try {
        const raw = await readFile(filePath, 'utf8')
        const firstPrompt = extractFirstTurnStart(raw)
        const title = firstPrompt?.trim() || formatSessionFileName(filePath)
        return {
            id: filePath,
            cwd,
            input: title,
            ts,
            sessionFile: filePath,
        }
    } catch {
        return null
    }
}

function extractFirstTurnStart(raw: string): string | null {
    for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let event: any
        try {
            event = JSON.parse(trimmed)
        } catch {
            continue
        }
        if (event && typeof event === 'object' && event.type === 'turn_start') {
            const content = typeof event.content === 'string' ? event.content.trim() : ''
            if (content) {
                return content
            }
        }
    }
    return null
}

function formatSessionFileName(filePath: string) {
    return basename(filePath).replace(/\.jsonl$/i, '')
}

function detectSuggestionTrigger(value: string): SuggestionTrigger | null {
    const modelsTrigger = detectModelsTrigger(value)
    if (modelsTrigger) return modelsTrigger
    const slashTrigger = detectSlashTrigger(value)
    if (slashTrigger) return slashTrigger
    const fileTrigger = detectFileTrigger(value)
    if (fileTrigger) return fileTrigger
    return detectHistoryTrigger(value)
}

function detectFileTrigger(value: string): FileTrigger | null {
    const atIndex = value.lastIndexOf('@')
    if (atIndex === -1) return null
    if (atIndex > 0) {
        const prevChar = value[atIndex - 1]
        if (prevChar && !/\s/.test(prevChar)) {
            return null
        }
    }
    const after = value.slice(atIndex + 1)
    if (/\s/.test(after)) return null
    return {
        type: 'file',
        query: after,
        tokenStart: atIndex + 1,
    }
}

function detectHistoryTrigger(value: string): HistoryTrigger | null {
    const trimmedStart = value.trimStart()
    const prefixLength = value.length - trimmedStart.length
    if (trimmedStart.length === 0) return null
    let normalized = trimmedStart
    if (normalized.startsWith('/')) {
        normalized = normalized.slice(1)
    }
    if (!normalized.toLowerCase().startsWith('history')) return null
    const hasOtherPrefix = value.slice(0, prefixLength).trim().length > 0
    if (hasOtherPrefix) return null
    const rest = normalized.slice('history'.length)
    if (rest && !rest.startsWith(' ')) return null
    return {
        type: 'history',
        keyword: rest.trim(),
    }
}

function detectModelsTrigger(value: string): ModelsTrigger | null {
    const trimmedStart = value.trimStart()
    if (!trimmedStart.startsWith('/models')) return null
    const rest = trimmedStart.slice('/models'.length)
    if (rest && !rest.startsWith(' ')) return null
    return { type: 'models', keyword: rest.trim() }
}

function detectSlashTrigger(value: string): SlashTrigger | null {
    const trimmedStart = value.trimStart()
    if (!trimmedStart.startsWith('/')) return null
    const keyword = trimmedStart.slice(1)
    if (keyword.includes(' ')) return null
    if (/^[a-zA-Z]*$/.test(keyword)) {
        return { type: 'slash', keyword: keyword.toLowerCase() }
    }
    if (keyword.length === 0) {
        return { type: 'slash', keyword: '' }
    }
    return null
}

function mapHistoryEntry(entry: InputHistoryEntry): SuggestionItem {
    return {
        id: entry.id,
        title: entry.input,
        subtitle: formatHistoryTimestamp(entry.ts),
        kind: 'history',
        badge: 'HIS',
        value: entry.input,
        meta: { historyEntry: entry },
    }
}

function formatHistoryTimestamp(ts: number) {
    if (!ts) return ''
    const date = new Date(ts)
    if (Number.isNaN(date.getTime())) return ''
    const yyyy = String(date.getFullYear())
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    const HH = String(date.getHours()).padStart(2, '0')
    const MM = String(date.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${HH}:${MM}`
}
