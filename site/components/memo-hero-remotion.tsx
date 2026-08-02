'use client'

import { Player } from '@remotion/player'
import { AbsoluteFill, useCurrentFrame } from 'remotion'

const FPS = 30
const ACTIVE_FRAMES = 14 * FPS
const HOLD_FRAMES = 8 * FPS
const DURATION_IN_FRAMES = ACTIVE_FRAMES + HOLD_FRAMES
const COMPOSITION_WIDTH = 1440
const COMPOSITION_HEIGHT = 900

const welcomeMeta = [
    {
        label: 'Model',
        value: 'deepseek-chat',
        suffix: ' (powered by deepseek)',
    },
    { label: 'Version', value: 'v0.6.31' },
    { label: 'MCP', value: 'howtocook-mcp' },
]

type ToolEvent = {
    kind?: 'used' | 'note'
    tool: string
    args?: string
}

const toolEvents: ToolEvent[] = [
    { kind: 'note', tool: "I'll examine the project structure to help you understand it better." },
    { tool: 'update_plan' },
    { tool: 'list_directory', args: '.' },
    { tool: 'read_text_file', args: 'package.json' },
    { tool: 'search_files', args: '**/*AGENTS*' },
    { tool: 'update_plan' },
    { tool: 'read_text_file', args: 'README.md' },
    { tool: 'read_text_file', args: 'tsconfig.json' },
    { tool: 'list_directory', args: 'packages' },
    { tool: 'read_text_file', args: 'packages/tui/src/cli.tsx' },
    { tool: 'read_text_file', args: 'packages/core/src/index.ts' },
    { tool: 'update_plan' },
]

const responseLines = [
    'Memo Code is a TypeScript monorepo CLI tool with two main packages:',
    '',
    'Core Structure:',
    '- packages/tui/: terminal runtime (CLI entry + interactive TUI, built with Ink/React)',
    '- packages/core/: Session state machine, LLM layer, config handling',
    '- packages/core/src/tools/: Built-in tools (exec_command, read_text_file, etc.)',
    '',
    'Key Features:',
    '- Terminal-based coding agent with interactive TUI',
    '- Supports DeepSeek (default) and OpenAI-compatible APIs',
    '- Uses MCP (Model Context Protocol) for tool integration',
    '- Monorepo with pnpm workspace, TypeScript ESM',
    '',
    'Development:',
    '- Node.js ≥22, pnpm for package management',
    '- Build with pnpm run build, test with pnpm test',
    '- Config stored in ~/.memo/config.toml',
    '- Runtime logs in ~/.memo/',
]

const questionPrompt = 'I want to quickly understand the project so as to develop it better.'

const typewriter = (text: string, frame: number, startFrame: number, charsPerStep = 2) => {
    if (frame < startFrame) {
        return ''
    }

    const typedChars = Math.floor((frame - startFrame) / charsPerStep)
    return text.slice(0, Math.min(text.length, typedChars))
}

const showAt = (frame: number, startFrame: number) => (frame >= startFrame ? 1 : 0)

const MemoHeroComposition = () => {
    const frame = useCurrentFrame()
    const playFrame = Math.min(frame, ACTIVE_FRAMES - 1)
    const commandStart = 20
    const commandCharsPerStep = 3
    const commandDoneFrame = commandStart + 'memo'.length * commandCharsPerStep
    const questionStart = 156
    const questionCharsPerStep = 1
    const questionDoneFrame = questionStart + questionPrompt.length * questionCharsPerStep
    const toolsStart = questionDoneFrame + 10
    const toolStagger = 6
    const responseStart = toolsStart + toolEvents.length * toolStagger + 18
    const finalPromptStart = responseStart + 12

    const commandText = typewriter('memo', playFrame, commandStart, commandCharsPerStep)
    const questionText = typewriter(questionPrompt, playFrame, questionStart, questionCharsPerStep)
    const welcomeBlockOpacity = showAt(playFrame, 52)
    const showCommandCursor = playFrame >= commandStart && playFrame < commandDoneFrame
    const showQuestionCursor = playFrame >= questionStart && playFrame < questionDoneFrame

    const cursorOpacity = playFrame % 26 < 13 ? 1 : 0.2

    return (
        <AbsoluteFill style={{ background: '#0d1117' }}>
            <div
                style={{
                    flex: 1,
                    borderRadius: 16,
                    overflow: 'hidden',
                    opacity: 1,
                    transform: 'none',
                }}
            >
                <div
                    style={{
                        height: 58,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '0 20px',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                        background: 'linear-gradient(180deg, rgba(17, 21, 33, 1) 0%, rgba(11, 14, 23, 1) 100%)',
                    }}
                >
                    <div
                        style={{
                            width: 12,
                            height: 12,
                            borderRadius: 999,
                            backgroundColor: '#f87171',
                        }}
                    />
                    <div
                        style={{
                            width: 12,
                            height: 12,
                            borderRadius: 999,
                            backgroundColor: '#fbbf24',
                        }}
                    />
                    <div
                        style={{
                            width: 12,
                            height: 12,
                            borderRadius: 999,
                            backgroundColor: '#34d399',
                        }}
                    />
                    <div
                        style={{
                            marginLeft: 12,
                            color: 'rgba(161, 161, 170, 0.85)',
                            fontSize: 14,
                            fontWeight: 500,
                            fontFamily: 'Inter, system-ui, sans-serif',
                        }}
                    >
                        memo • terminal session
                    </div>
                </div>

                <div
                    style={{
                        position: 'relative',
                        height: COMPOSITION_HEIGHT - 58,
                        padding: '18px 22px',
                        fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 13,
                        lineHeight: 1.24,
                        color: '#e5e7eb',
                        whiteSpace: 'pre',
                        letterSpacing: 0.2,
                        overflow: 'hidden',
                        background: 'linear-gradient(180deg, rgba(13, 17, 23, 1) 0%, rgba(10, 14, 20, 1) 100%)',
                    }}
                >
                    <div>
                        <span style={{ color: '#32d74b' }}>➜ </span>
                        <span style={{ color: '#22d3ee', fontWeight: 700 }}>memo-cli</span>
                        <span style={{ color: '#8b5cf6' }}> git:</span>
                        <span style={{ color: '#f97316' }}>(dev)</span>
                        <span style={{ color: '#c9d13a' }}> ✗</span>
                        <span style={{ color: '#f3f4f6' }}> {commandText}</span>
                        {showCommandCursor ? <span style={{ opacity: cursorOpacity, color: '#818cf8' }}>▊</span> : null}
                    </div>

                    <div style={{ marginTop: 6, opacity: welcomeBlockOpacity }}>
                        <div
                            style={{
                                maxWidth: 470,
                                border: '1px solid #a6abf2',
                                borderRadius: 8,
                                background: 'linear-gradient(135deg, rgba(22, 24, 35, 0.78), rgba(14, 17, 28, 0.72))',
                                padding: '10px 14px 12px',
                                whiteSpace: 'normal',
                            }}
                        >
                            <div style={{ color: '#f3f4f6', fontWeight: 700 }}>Welcome to Memo Code!</div>
                            <div style={{ color: '#a1a1aa' }}>
                                Send <span style={{ color: '#facc15' }}>/help</span> for help information.
                            </div>
                            <div style={{ height: 8 }} />
                            {welcomeMeta.map((item) => (
                                <div key={item.label}>
                                    <span
                                        style={{
                                            color: '#a1a1aa',
                                            display: 'inline-block',
                                            width: 92,
                                        }}
                                    >
                                        {item.label}:
                                    </span>
                                    <span style={{ color: '#22d3ee' }}>{item.value}</span>
                                    {item.suffix ? <span style={{ color: '#a1a1aa' }}>{item.suffix}</span> : null}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop: 8,
                            opacity: showAt(playFrame, questionStart),
                            color: '#f9fafb',
                        }}
                    >
                        › {questionText}
                        {showQuestionCursor && <span style={{ opacity: cursorOpacity, color: '#818cf8' }}>▊</span>}
                    </div>

                    <div style={{ marginTop: 6 }}>
                        {toolEvents.map((item, index) => (
                            <div
                                key={`${item.tool}-${item.args ?? index}`}
                                style={{
                                    opacity: showAt(playFrame, toolsStart + index * toolStagger),
                                }}
                            >
                                {item.kind === 'note' ? (
                                    <>
                                        <span style={{ color: '#32d74b' }}>● </span>
                                        <span style={{ color: '#d1d5db' }}>{item.tool}</span>
                                    </>
                                ) : (
                                    <>
                                        <span style={{ color: '#32d74b' }}>●</span>
                                        <span style={{ color: '#9ca3af' }}> Used </span>
                                        <span style={{ color: '#22d3ee' }}>{item.tool}</span>
                                        {item.args ? (
                                            <>
                                                <span style={{ color: '#9ca3af' }}> (</span>
                                                <span style={{ color: '#22d3ee' }}>{item.args}</span>
                                                <span style={{ color: '#9ca3af' }}>)</span>
                                            </>
                                        ) : null}
                                    </>
                                )}
                            </div>
                        ))}
                    </div>

                    <div style={{ marginTop: 6, opacity: showAt(playFrame, responseStart) }}>
                        {responseLines.map((line, index) => {
                            const isHeading = line.endsWith(':') && !line.startsWith('-')
                            const isBullet = line.startsWith('-')
                            return (
                                <div
                                    key={`${line}-${index}`}
                                    style={{
                                        color: isHeading ? '#f3f4f6' : isBullet ? '#cbd5e1' : '#f3f4f6',
                                        fontWeight: isHeading ? 600 : 400,
                                    }}
                                >
                                    {line || ' '}
                                </div>
                            )
                        })}
                    </div>

                    <div
                        style={{
                            marginTop: 6,
                            opacity: showAt(playFrame, finalPromptStart),
                            color: '#f3f4f6',
                        }}
                    >
                        {'›'} <span style={{ opacity: cursorOpacity, color: '#22d3ee' }}>▊</span>
                    </div>
                </div>
            </div>
        </AbsoluteFill>
    )
}

export function MemoHeroRemotion() {
    return (
        <Player
            component={MemoHeroComposition}
            durationInFrames={DURATION_IN_FRAMES}
            compositionWidth={COMPOSITION_WIDTH}
            compositionHeight={COMPOSITION_HEIGHT}
            fps={FPS}
            autoPlay
            loop
            initiallyMuted
            controls={false}
            clickToPlay={false}
            acknowledgeRemotionLicense
            style={{
                width: '100%',
                height: 'auto',
                aspectRatio: `${COMPOSITION_WIDTH} / ${COMPOSITION_HEIGHT}`,
            }}
        />
    )
}
