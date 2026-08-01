import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import type { MCPServerConfig, ProviderConfig } from '@memo/core'
import { resolveSlashCommand, SLASH_SPECS, type SlashContext } from '@memo/core/features/slash'
import { getFileSuggestions } from './fileSuggestions'
import { loadSessionHistoryEntries, type SessionHistoryEntry } from '../session/sessionHistory'
import { SuggestionPanel, type SuggestionItem } from './SuggestionPanel'
import {
    backspaceAtCursor,
    deleteAtCursor,
    deleteToLineEnd,
    deleteToLineStart,
    deleteWordBackwardAtCursor,
    getWrappedCursorLayout,
    insertAtCursor,
    moveCursorLeft,
    moveCursorRight,
    moveCursorToLineEnd,
    moveCursorToLineStart,
    moveCursorVertical,
    type EditorBuffer,
} from './composerInput'
import { resolveDeleteKind } from './composerKeys'
import { PasteBurst, type PasteBurstFlushResult } from './pasteBurst'
import {
    formatSlashCommand,
    SLASH_COMMANDS,
    TOOL_PERMISSION_MODES,
    type ToolPermissionMode,
} from '../../shared/lib/constants'

const DOUBLE_ESC_WINDOW_MS = 400
const CTRL_D_EXIT_WINDOW_MS = 1500
const MODELS_SLASH_PREFIX = formatSlashCommand(SLASH_COMMANDS.MODELS)
const TOOLS_SLASH_PREFIX = formatSlashCommand(SLASH_COMMANDS.TOOLS)
const INIT_SLASH_COMMAND = formatSlashCommand(SLASH_COMMANDS.INIT)
const TOOL_MODE_OPTIONS: Array<{ mode: ToolPermissionMode; description: string }> = [
    { mode: TOOL_PERMISSION_MODES.NONE, description: 'Disable all tool calls' },
    { mode: TOOL_PERMISSION_MODES.ONCE, description: 'Require approval when needed' },
    { mode: TOOL_PERMISSION_MODES.FULL, description: 'Run tools without approval' },
]

type ComposerProps = {
    disabled: boolean
    busy: boolean
    history: string[]
    cwd: string
    sessionsDir: string
    currentSessionFile?: string
    providers: ProviderConfig[]
    configPath: string
    providerName: string
    model: string
    toolPermissionMode: ToolPermissionMode
    mcpServers: Record<string, MCPServerConfig>
    onSubmit: (value: string) => void
    onExit: () => void
    onClear: () => void
    onNewSession: () => void
    onCancelRun: () => void
    onCompact: () => void
    onHistorySelect: (entry: SessionHistoryEntry) => void
    onModelSelect: (provider: ProviderConfig) => void
    onToggleThinking: () => void
    onSetToolPermission: (mode: ToolPermissionMode) => void
    onReviewPullRequest: (prNumber: number) => void
    onSystemMessage: (title: string, content: string) => void
}

type SuggestionMode = 'none' | 'file' | 'history' | 'slash' | 'model' | 'tools'

type SuggestionMeta =
    | { type: 'file'; isDir?: boolean }
    | { type: 'history'; entry: SessionHistoryEntry }
    | { type: 'slash' }
    | { type: 'model'; provider: ProviderConfig }
    | { type: 'tools'; mode: ToolPermissionMode }

type SuggestionRecord = SuggestionItem & {
    value: string
    meta?: SuggestionMeta
}

type FileTrigger = { type: 'file'; query: string; tokenStart: number }
type HistoryTrigger = { type: 'history'; keyword: string }
type SlashTrigger = { type: 'slash'; keyword: string }
type ModelTrigger = { type: 'models'; keyword: string }
type ToolsTrigger = { type: 'tools' }
type Trigger = FileTrigger | HistoryTrigger | SlashTrigger | ModelTrigger | ToolsTrigger

function detectFileTrigger(value: string): FileTrigger | null {
    const atIndex = value.lastIndexOf('@')
    if (atIndex === -1) return null
    if (atIndex > 0) {
        const prev = value[atIndex - 1]
        if (prev && !/\s/.test(prev)) return null
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
    if (!trimmedStart.length) return null

    let normalized = trimmedStart
    if (normalized.startsWith('/')) {
        normalized = normalized.slice(1)
    }
    if (!normalized.toLowerCase().startsWith(SLASH_COMMANDS.RESUME)) return null
    const hasOtherPrefix = value.slice(0, prefixLength).trim().length > 0
    if (hasOtherPrefix) return null

    const rest = normalized.slice(SLASH_COMMANDS.RESUME.length)
    if (rest && !rest.startsWith(' ')) return null

    return {
        type: 'history',
        keyword: rest.trim(),
    }
}

function detectSlashTrigger(value: string): SlashTrigger | null {
    const trimmed = value.trimStart()
    if (!trimmed.startsWith('/')) return null
    const keyword = trimmed.slice(1)
    if (keyword.includes(' ')) return null
    if (!keyword.length) return { type: 'slash', keyword: '' }
    if (/^[a-zA-Z-]+$/.test(keyword)) {
        return { type: 'slash', keyword: keyword.toLowerCase() }
    }
    return null
}

function detectModelsTrigger(value: string): ModelTrigger | null {
    const trimmed = value.trimStart()
    if (!trimmed.startsWith(MODELS_SLASH_PREFIX)) return null
    const rest = trimmed.slice(MODELS_SLASH_PREFIX.length)
    if (rest && !rest.startsWith(' ')) return null
    return {
        type: 'models',
        keyword: rest.trim().toLowerCase(),
    }
}

function detectToolsTrigger(value: string): ToolsTrigger | null {
    const trimmed = value.trimStart()
    if (!trimmed.startsWith(TOOLS_SLASH_PREFIX)) return null
    const rest = trimmed.slice(TOOLS_SLASH_PREFIX.length)
    if (rest && !rest.startsWith(' ')) return null
    return { type: 'tools' }
}

function detectTrigger(value: string): Trigger | null {
    return (
        detectToolsTrigger(value) ??
        detectModelsTrigger(value) ??
        detectSlashTrigger(value) ??
        detectFileTrigger(value) ??
        detectHistoryTrigger(value)
    )
}

function formatTimestamp(ts: number): string {
    const date = new Date(ts)
    if (Number.isNaN(date.getTime())) return ''
    const yyyy = String(date.getFullYear())
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    const HH = String(date.getHours()).padStart(2, '0')
    const MM = String(date.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${HH}:${MM}`
}

type SuggestionBuildInput = {
    trigger: Trigger
    cwd: string
    sessionsDir: string
    currentSessionFile?: string
    providers: ProviderConfig[]
    toolPermissionMode: ToolPermissionMode
}

type SuggestionBuildResult = {
    mode: SuggestionMode
    items: SuggestionRecord[]
}

function buildModelSuggestions(providers: ProviderConfig[], keyword: string): SuggestionBuildResult {
    const items: SuggestionRecord[] = providers
        .filter((provider) => {
            if (!keyword) return true
            const name = provider.name.toLowerCase()
            const modelName = provider.model.toLowerCase()
            return name.includes(keyword) || modelName.includes(keyword)
        })
        .map((provider) => ({
            id: provider.name,
            title: `${provider.name}: ${provider.model}`,
            subtitle: provider.base_url,
            kind: 'model',
            value: `${MODELS_SLASH_PREFIX} ${provider.name}`,
            meta: { type: 'model', provider },
        }))

    return { mode: 'model', items }
}

function buildToolSuggestions(toolPermissionMode: ToolPermissionMode): SuggestionBuildResult {
    const items: SuggestionRecord[] = TOOL_MODE_OPTIONS.map((option) => ({
        id: option.mode,
        title: option.mode,
        subtitle: option.mode === toolPermissionMode ? `Current · ${option.description}` : option.description,
        kind: 'tools',
        value: `${TOOLS_SLASH_PREFIX} ${option.mode}`,
        meta: { type: 'tools', mode: option.mode },
    }))
    return { mode: 'tools', items }
}

function buildSlashSuggestions(keyword: string): SuggestionBuildResult {
    const items: SuggestionRecord[] = SLASH_SPECS.filter((spec) => spec.name.startsWith(keyword)).map((spec) => ({
        id: spec.name,
        title: `/${spec.name}`,
        subtitle: spec.description,
        kind: 'slash',
        value: `/${spec.name}`,
        meta: { type: 'slash' },
    }))

    return { mode: 'slash', items }
}

async function buildSuggestionsForTrigger({
    trigger,
    cwd,
    sessionsDir,
    currentSessionFile,
    providers,
    toolPermissionMode,
}: SuggestionBuildInput): Promise<SuggestionBuildResult> {
    switch (trigger.type) {
        case 'file': {
            const matches = await getFileSuggestions({
                cwd,
                query: trigger.query,
                limit: 8,
                respectGitIgnore: true,
            })
            const items: SuggestionRecord[] = matches.map((match) => ({
                id: match.id,
                title: match.isDir ? `${match.path}/` : match.path,
                kind: 'file',
                value: match.isDir ? `${match.path}/` : match.path,
                meta: { type: 'file', isDir: match.isDir },
            }))
            return { mode: 'file', items }
        }

        case 'history': {
            const entries = await loadSessionHistoryEntries({
                sessionsDir,
                cwd,
                keyword: trigger.keyword,
                activeSessionFile: currentSessionFile,
            })
            const items: SuggestionRecord[] = entries.map((entry) => ({
                id: entry.id,
                title: entry.input,
                subtitle: formatTimestamp(entry.ts),
                kind: 'history',
                value: entry.input,
                meta: { type: 'history', entry },
            }))
            return { mode: 'history', items }
        }

        case 'models':
            return buildModelSuggestions(providers, trigger.keyword)

        case 'tools':
            return buildToolSuggestions(toolPermissionMode)

        case 'slash':
            return buildSlashSuggestions(trigger.keyword)
    }
}

export const Composer = memo(function Composer({
    disabled,
    busy,
    history,
    cwd,
    sessionsDir,
    currentSessionFile,
    providers,
    configPath,
    providerName,
    model,
    toolPermissionMode,
    mcpServers,
    onSubmit,
    onExit,
    onClear,
    onNewSession,
    onCancelRun,
    onCompact,
    onHistorySelect,
    onModelSelect,
    onSetToolPermission,
    onToggleThinking,
    onReviewPullRequest,
    onSystemMessage,
}: ComposerProps) {
    const { stdout } = useStdout()
    const [editor, setEditor] = useState<EditorBuffer>({ value: '', cursor: 0 })
    const editorRef = useRef<EditorBuffer>(editor)
    const preferredColumnRef = useRef<number | null>(null)

    const [historyIndex, setHistoryIndex] = useState<number | null>(null)
    const [draft, setDraft] = useState('')

    const [mode, setMode] = useState<SuggestionMode>('none')
    const [items, setItems] = useState<SuggestionRecord[]>([])
    const [activeIndex, setActiveIndex] = useState(0)
    const [loading, setLoading] = useState(false)
    const [suppressSuggestions, setSuppressSuggestions] = useState(false)

    const requestIdRef = useRef(0)
    const lastEscTimeRef = useRef(0)
    const lastCtrlDTimeRef = useRef(0)
    const pasteBurstRef = useRef(new PasteBurst())

    useEffect(() => {
        editorRef.current = editor
        setSuppressSuggestions(false)
    }, [editor])

    const slashContext = useMemo<SlashContext>(
        () => ({
            configPath,
            providerName,
            model,
            mcpServers,
            providers,
            toolPermissionMode,
        }),
        [configPath, providerName, model, mcpServers, providers, toolPermissionMode],
    )

    const trigger = useMemo(() => {
        if (disabled || suppressSuggestions) return null
        return detectTrigger(editor.value)
    }, [disabled, editor.value, suppressSuggestions])

    const closeSuggestions = useCallback((suppress = true) => {
        if (suppress) setSuppressSuggestions(true)
        setMode('none')
        setItems([])
        setActiveIndex(0)
        setLoading(false)
    }, [])

    const commitEditor = useCallback((next: EditorBuffer, resetHistory = false) => {
        editorRef.current = next
        setEditor(next)
        if (resetHistory) {
            setHistoryIndex(null)
            setDraft('')
        }
    }, [])

    const clearComposerValue = useCallback(() => {
        commitEditor({ value: '', cursor: 0 }, true)
    }, [commitEditor])

    const applyEditorInsert = useCallback(
        (text: string, resetHistory = true) => {
            if (!text) return
            const current = editorRef.current
            preferredColumnRef.current = null
            const next = insertAtCursor(current.value, current.cursor, text)
            commitEditor(next, resetHistory)
            if (text.includes('\n')) {
                closeSuggestions(false)
            }
        },
        [commitEditor, closeSuggestions],
    )

    const applyPasteBurstFlush = useCallback(
        (result: PasteBurstFlushResult) => {
            if (result.type === 'none') return false
            if (result.type === 'paste') {
                if (result.text) {
                    applyEditorInsert(result.text, true)
                }
                return true
            }
            applyEditorInsert(result.text, true)
            return true
        },
        [applyEditorInsert],
    )

    const flushPasteBurstBeforeModifiedInput = useCallback(
        (clearWindow = true) => {
            const buffered = pasteBurstRef.current.flushBeforeModifiedInput()
            if (buffered) {
                applyEditorInsert(buffered, true)
            }
            if (clearWindow) {
                pasteBurstRef.current.clearWindowAfterNonChar()
            }
            return Boolean(buffered)
        },
        [applyEditorInsert],
    )

    useEffect(() => {
        const interval = setInterval(() => {
            const result = pasteBurstRef.current.flushIfDue(Date.now())
            applyPasteBurstFlush(result)
        }, PasteBurst.recommendedFlushDelayMs())

        return () => {
            clearInterval(interval)
        }
    }, [applyPasteBurstFlush])

    useEffect(() => {
        if (disabled) {
            closeSuggestions(false)
        }
    }, [disabled, closeSuggestions])

    useEffect(() => {
        if (!trigger) {
            closeSuggestions(false)
            return
        }

        let cancelled = false
        const requestId = ++requestIdRef.current
        setLoading(true)
        ;(async () => {
            try {
                const { mode: nextMode, items: nextItems } = await buildSuggestionsForTrigger({
                    trigger,
                    cwd,
                    sessionsDir,
                    currentSessionFile,
                    providers,
                    toolPermissionMode,
                })
                if (cancelled || requestId !== requestIdRef.current) return
                setMode(nextMode)
                setItems(nextItems)
                setActiveIndex((prev) => (nextItems.length ? Math.min(prev, nextItems.length - 1) : 0))
            } finally {
                if (!cancelled && requestId === requestIdRef.current) {
                    setLoading(false)
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [trigger, cwd, sessionsDir, currentSessionFile, providers, toolPermissionMode, closeSuggestions])

    const applySuggestion = useCallback(
        (record?: SuggestionRecord) => {
            if (!record) return

            if (mode === 'file' && trigger?.type === 'file') {
                const current = editorRef.current.value
                const prefix = current.slice(0, trigger.tokenStart)
                const suffix = current.slice(trigger.tokenStart + trigger.query.length)
                const next = `${prefix}${record.value}${suffix}`
                const cursor = prefix.length + record.value.length
                commitEditor({ value: next, cursor }, true)
                if (!(record.meta?.type === 'file' && record.meta.isDir)) {
                    closeSuggestions()
                }
                return
            }

            switch (record.meta?.type) {
                case 'history':
                    onHistorySelect(record.meta.entry)
                    commitEditor({ value: record.value, cursor: record.value.length }, false)
                    closeSuggestions()
                    return

                case 'model':
                    onModelSelect(record.meta.provider)
                    clearComposerValue()
                    closeSuggestions()
                    return

                case 'tools':
                    onSetToolPermission(record.meta.mode)
                    clearComposerValue()
                    closeSuggestions()
                    return

                case 'slash':
                    commitEditor({ value: `${record.value} `, cursor: `${record.value} `.length }, true)
                    closeSuggestions(false)
                    return

                default:
                    commitEditor({ value: record.value, cursor: record.value.length }, true)
                    closeSuggestions()
            }
        },
        [
            commitEditor,
            mode,
            trigger,
            closeSuggestions,
            clearComposerValue,
            onHistorySelect,
            onModelSelect,
            onSetToolPermission,
        ],
    )

    // Note: Ctrl+C is handled by Ink's built-in exit (exitOnCtrlC defaults to
    // true), so it never reaches useInput handlers.
    useInput(
        (input, key) => {
            const now = Date.now()
            applyPasteBurstFlush(pasteBurstRef.current.flushIfDue(now))

            const hasSuggestions = mode !== 'none'
            const canNavigate = hasSuggestions && items.length > 0

            const deleteKind = resolveDeleteKind(input, key)
            const hasCtrlOrMeta = Boolean(key.ctrl || key.meta)
            const isPlainInputChar =
                Boolean(input) &&
                !hasCtrlOrMeta &&
                !key.return &&
                !key.tab &&
                deleteKind === 'none' &&
                !key.escape &&
                !key.upArrow &&
                !key.downArrow &&
                !key.leftArrow &&
                !key.rightArrow

            if (!isPlainInputChar && !key.return) {
                flushPasteBurstBeforeModifiedInput(true)
            }

            if (key.ctrl && input === 'a') {
                const current = editorRef.current
                const cursor = moveCursorToLineStart(current.value, current.cursor)
                preferredColumnRef.current = null
                commitEditor({ value: current.value, cursor }, false)
                return
            }

            if (key.ctrl && input === 'e') {
                const current = editorRef.current
                const cursor = moveCursorToLineEnd(current.value, current.cursor)
                preferredColumnRef.current = null
                commitEditor({ value: current.value, cursor }, false)
                return
            }

            if (key.ctrl && input === 'u') {
                const current = editorRef.current
                const next = deleteToLineStart(current.value, current.cursor)
                preferredColumnRef.current = null
                commitEditor(next, true)
                return
            }

            if (key.ctrl && input === 'k') {
                const current = editorRef.current
                const next = deleteToLineEnd(current.value, current.cursor)
                preferredColumnRef.current = null
                commitEditor(next, true)
                return
            }

            if (key.ctrl && input === 'w') {
                const current = editorRef.current
                const next = deleteWordBackwardAtCursor(current.value, current.cursor)
                preferredColumnRef.current = null
                commitEditor(next, true)
                return
            }

            if (key.ctrl && input === 'd') {
                const current = editorRef.current
                if (!current.value) {
                    // Ctrl+D on an empty input exits, but only on a second press
                    // (first press is likely a stray keystroke).
                    const now = Date.now()
                    if (now - lastCtrlDTimeRef.current <= CTRL_D_EXIT_WINDOW_MS) {
                        onExit()
                    } else {
                        lastCtrlDTimeRef.current = now
                        onSystemMessage('Exit', `Press Ctrl+D again within ${CTRL_D_EXIT_WINDOW_MS / 1000}s to exit.`)
                    }
                    return
                }
                const next = deleteAtCursor(current.value, current.cursor)
                preferredColumnRef.current = null
                commitEditor(next, true)
                return
            }

            if (key.ctrl && input === 'l') {
                commitEditor({ value: '', cursor: 0 }, true)
                closeSuggestions()
                onClear()
                onNewSession()
                return
            }

            if (key.escape) {
                if (now - lastEscTimeRef.current <= DOUBLE_ESC_WINDOW_MS) {
                    lastEscTimeRef.current = 0
                    if (busy) {
                        onCancelRun()
                    } else {
                        preferredColumnRef.current = null
                        commitEditor({ value: '', cursor: 0 }, true)
                        closeSuggestions()
                    }
                    return
                }
                lastEscTimeRef.current = now
                if (hasSuggestions) closeSuggestions()
                return
            }

            if (key.upArrow) {
                if (canNavigate) {
                    setActiveIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1))
                    return
                }

                const current = editorRef.current
                if (current.value.includes('\n')) {
                    const moved = moveCursorVertical(
                        current.value,
                        current.cursor,
                        'up',
                        preferredColumnRef.current ?? undefined,
                    )
                    if (moved.changed) {
                        preferredColumnRef.current = moved.preferredColumn
                        commitEditor({ value: current.value, cursor: moved.cursor }, false)
                        return
                    }
                }

                if (!history.length) return
                if (historyIndex === null) {
                    setDraft(current.value)
                    const nextIndex = history.length - 1
                    setHistoryIndex(nextIndex)
                    const next = history[nextIndex] ?? ''
                    preferredColumnRef.current = null
                    commitEditor({ value: next, cursor: next.length }, false)
                    return
                }
                const nextIndex = Math.max(0, historyIndex - 1)
                setHistoryIndex(nextIndex)
                const next = history[nextIndex] ?? ''
                preferredColumnRef.current = null
                commitEditor({ value: next, cursor: next.length }, false)
                return
            }

            if (key.downArrow) {
                if (canNavigate) {
                    setActiveIndex((prev) => (prev + 1) % items.length)
                    return
                }

                const current = editorRef.current
                if (current.value.includes('\n')) {
                    const moved = moveCursorVertical(
                        current.value,
                        current.cursor,
                        'down',
                        preferredColumnRef.current ?? undefined,
                    )
                    if (moved.changed) {
                        preferredColumnRef.current = moved.preferredColumn
                        commitEditor({ value: current.value, cursor: moved.cursor }, false)
                        return
                    }
                }

                if (historyIndex === null) return
                const nextIndex = historyIndex + 1
                if (nextIndex >= history.length) {
                    setHistoryIndex(null)
                    preferredColumnRef.current = null
                    commitEditor({ value: draft, cursor: draft.length }, false)
                    setDraft('')
                    return
                }
                setHistoryIndex(nextIndex)
                const next = history[nextIndex] ?? ''
                preferredColumnRef.current = null
                commitEditor({ value: next, cursor: next.length }, false)
                return
            }

            if (key.leftArrow) {
                const current = editorRef.current
                const cursor = moveCursorLeft(current.value, current.cursor)
                preferredColumnRef.current = null
                commitEditor({ value: current.value, cursor }, false)
                return
            }

            if (key.rightArrow) {
                const current = editorRef.current
                const cursor = moveCursorRight(current.value, current.cursor)
                preferredColumnRef.current = null
                commitEditor({ value: current.value, cursor }, false)
                return
            }

            if (key.tab && canNavigate) {
                applySuggestion(items[activeIndex])
                return
            }

            // Empty input + Tab toggles thinking mode (opencode-style shortcut).
            if (key.tab && !canNavigate && editorRef.current.value === '') {
                onToggleThinking()
                return
            }

            if (key.return) {
                if (canNavigate) {
                    applySuggestion(items[activeIndex])
                    return
                }

                if (pasteBurstRef.current.hasPendingFirstChar() && !pasteBurstRef.current.isBuffering()) {
                    flushPasteBurstBeforeModifiedInput(false)
                }

                const slashBypass = editorRef.current.value.trimStart().startsWith('/')
                if (!key.shift && !slashBypass) {
                    if (pasteBurstRef.current.appendNewlineIfActive(now)) {
                        return
                    }

                    if (pasteBurstRef.current.newlineShouldInsertInsteadOfSubmit(now)) {
                        flushPasteBurstBeforeModifiedInput(false)
                        applyEditorInsert('\n', true)
                        pasteBurstRef.current.extendWindow(now)
                        return
                    }
                }

                flushPasteBurstBeforeModifiedInput(true)

                if (key.shift) {
                    applyEditorInsert('\n', true)
                    return
                }

                const currentText = editorRef.current.value
                const trimmed = currentText.trim()
                if (!trimmed) return

                if (trimmed.startsWith('/')) {
                    const result = resolveSlashCommand(trimmed, slashContext)
                    switch (result.kind) {
                        case 'message':
                            onSystemMessage(result.title, result.content)
                            break
                        case 'new':
                            onNewSession()
                            break
                        case 'exit':
                            onExit()
                            break
                        case 'switch_model':
                            onModelSelect(result.provider)
                            break
                        case 'set_tool_permission':
                            onSetToolPermission(result.mode)
                            break
                        case 'compact':
                            onCompact()
                            break
                        case 'review_pr':
                            onReviewPullRequest(result.prNumber)
                            break
                        case 'init_agents_md':
                            onSubmit(INIT_SLASH_COMMAND)
                            break
                        default: {
                            const _exhaustive: never = result
                            void _exhaustive
                        }
                    }
                    preferredColumnRef.current = null
                    commitEditor({ value: '', cursor: 0 }, true)
                    closeSuggestions(false)
                    return
                }

                onSubmit(trimmed)
                preferredColumnRef.current = null
                commitEditor({ value: '', cursor: 0 }, true)
                closeSuggestions(false)
                return
            }

            if (deleteKind !== 'none') {
                const current = editorRef.current
                const next =
                    deleteKind === 'backspace'
                        ? backspaceAtCursor(current.value, current.cursor)
                        : deleteAtCursor(current.value, current.cursor)
                preferredColumnRef.current = null
                commitEditor(next, true)
                return
            }

            if (input && isPlainInputChar) {
                const chars = Array.from(input)
                if (chars.length !== 1) {
                    flushPasteBurstBeforeModifiedInput(false)
                    applyEditorInsert(input, true)
                    pasteBurstRef.current.clearAfterExplicitPaste()
                    return
                }

                const ch = chars[0] ?? ''
                if (!ch) return

                const maybeBeginBuffer = (retroChars: number): boolean => {
                    const snapshot = editorRef.current
                    const before = snapshot.value.slice(0, snapshot.cursor)
                    const after = snapshot.value.slice(snapshot.cursor)
                    const grab = pasteBurstRef.current.decideBeginBuffer(now, before, retroChars)
                    if (!grab) return false
                    preferredColumnRef.current = null
                    commitEditor(
                        {
                            value: `${before.slice(0, grab.start)}${after}`,
                            cursor: grab.start,
                        },
                        true,
                    )
                    pasteBurstRef.current.appendCharToBuffer(ch, now)
                    return true
                }

                const isAscii = (ch.codePointAt(0) ?? 0) <= 0x7f
                if (!isAscii) {
                    const decision = pasteBurstRef.current.onPlainCharNoHold(now)
                    if (decision?.type === 'buffer_append') {
                        pasteBurstRef.current.appendCharToBuffer(ch, now)
                        return
                    }
                    if (decision?.type === 'begin_buffer' && maybeBeginBuffer(decision.retroChars)) {
                        return
                    }

                    flushPasteBurstBeforeModifiedInput(false)
                    applyEditorInsert(ch, true)
                    return
                }

                const decision = pasteBurstRef.current.onPlainChar(ch, now)
                if (decision.type === 'retain_first_char') {
                    return
                }
                if (decision.type === 'buffer_append' || decision.type === 'begin_buffer_from_pending') {
                    pasteBurstRef.current.appendCharToBuffer(ch, now)
                    return
                }
                if (decision.type === 'begin_buffer' && maybeBeginBuffer(decision.retroChars)) {
                    return
                }

                flushPasteBurstBeforeModifiedInput(false)
                applyEditorInsert(ch, true)
                return
            }

            if (input) {
                applyEditorInsert(input, true)
                pasteBurstRef.current.clearWindowAfterNonChar()
            }
        },
        { isActive: !disabled },
    )

    const terminalWidth = stdout?.columns ?? process.stdout?.columns ?? 80
    // Reserve prompt prefix width (2) and one cell for the synthetic cursor block.
    const composerContentWidth = Math.max(1, terminalWidth - 3)
    const wrappedLayout = getWrappedCursorLayout(editor.value, editor.cursor, composerContentWidth)
    const lines = wrappedLayout.lines

    return (
        <Box flexDirection="column" gap={1}>
            <Box flexDirection="column" paddingY={1}>
                {lines.map((line, index) => {
                    const lineText = line.text
                    const isCursorRow = !disabled && index === wrappedLayout.row
                    const before = isCursorRow ? lineText.slice(0, wrappedLayout.cursorInRow) : lineText
                    const after = isCursorRow ? lineText.slice(wrappedLayout.cursorInRow) : ''

                    return (
                        <Box key={`line-${index}`}>
                            <Text color="gray">{index === 0 ? '› ' : '  '}</Text>
                            <Text>{before}</Text>
                            {isCursorRow ? <Text color="cyan">▊</Text> : null}
                            {isCursorRow ? <Text>{after}</Text> : null}
                        </Box>
                    )
                })}
            </Box>

            {mode !== 'none' ? (
                <SuggestionPanel
                    items={items.map(({ value: _value, meta: _meta, ...display }) => display)}
                    activeIndex={activeIndex}
                    loading={loading}
                />
            ) : null}
        </Box>
    )
})
