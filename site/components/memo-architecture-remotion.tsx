'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

const DESIGN_WIDTH = 1440
const DESIGN_HEIGHT = 940

const MAIN_X = 172
const MAIN_W = 1076
const LABEL_X = 28
const LABEL_W = 132

const RIGHT_AUDIT_X = 1262
const RIGHT_COL_W = 74
const RIGHT_AUTH_X = 1346

const COLORS = {
    frameBg: '#0b0b0b',
    frameBgAlt: '#070707',
    panel: 'rgba(16,16,16,0.88)',
    panelAlt: 'rgba(20,20,20,0.9)',
    card: 'rgba(255,255,255,0.04)',
    cardHighlight: 'rgba(255,255,255,0.1)',
    border: 'rgba(255,255,255,0.2)',
    borderStrong: 'rgba(255,255,255,0.28)',
    text: '#f2f2f2',
    textMuted: '#a5a5a5',
    line: 'rgba(212,212,212,0.68)',
}

type LayerProps = {
    y: number
    h: number
    label: string
    labelBg: string
    rowBg: string
    children: ReactNode
}

type MiniCardProps = {
    title: string
    sub?: string
    highlight?: boolean
}

function MiniCard({ title, sub, highlight = false }: MiniCardProps) {
    return (
        <div
            style={{
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                background: highlight ? COLORS.cardHighlight : COLORS.card,
                color: COLORS.text,
                fontFamily: 'Inter, system-ui, sans-serif',
                minHeight: 46,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: '4px 8px',
                lineHeight: 1.2,
                minWidth: 0,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 18px rgba(0,0,0,0.32)',
            }}
        >
            <div
                style={{
                    fontSize: 17,
                    fontWeight: 600,
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                }}
            >
                {title}
            </div>
            {sub ? (
                <div
                    style={{
                        marginTop: 3,
                        fontSize: 12,
                        color: COLORS.textMuted,
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                    }}
                >
                    {sub}
                </div>
            ) : null}
        </div>
    )
}

function Layer({ y, h, label, labelBg, rowBg, children }: LayerProps) {
    return (
        <>
            <div
                style={{
                    position: 'absolute',
                    left: LABEL_X,
                    top: y,
                    width: LABEL_W,
                    height: h,
                    clipPath: 'polygon(13% 0, 100% 0, 100% 100%, 13% 100%, 0 50%)',
                    background: labelBg,
                    border: `1px solid ${COLORS.borderStrong}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: COLORS.text,
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: 32,
                    fontWeight: 600,
                    lineHeight: 1.15,
                    textAlign: 'center',
                    padding: '0 10px',
                    zIndex: 2,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 20px rgba(0,0,0,0.34)',
                }}
            >
                {label}
            </div>

            <div
                style={{
                    position: 'absolute',
                    left: MAIN_X,
                    top: y,
                    width: MAIN_W,
                    height: h,
                    borderRadius: 8,
                    border: `1px solid ${COLORS.borderStrong}`,
                    background: rowBg,
                    padding: 14,
                    zIndex: 2,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 28px rgba(0,0,0,0.38)',
                }}
            >
                {children}
            </div>
        </>
    )
}

export function MemoArchitectureDiagram() {
    const containerRef = useRef<HTMLDivElement>(null)
    const [scale, setScale] = useState(1)

    useEffect(() => {
        const node = containerRef.current
        if (!node) return

        const updateScale = () => {
            const nextWidth = node.clientWidth
            if (!nextWidth) return
            setScale(Math.min(nextWidth / DESIGN_WIDTH, 1))
        }

        updateScale()

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateScale)
            return () => window.removeEventListener('resize', updateScale)
        }

        const observer = new ResizeObserver(() => updateScale())
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    return (
        <div
            ref={containerRef}
            style={{
                position: 'relative',
                width: '100%',
                aspectRatio: `${DESIGN_WIDTH} / ${DESIGN_HEIGHT}`,
                borderRadius: 12,
                overflow: 'hidden',
                border: `1px solid ${COLORS.border}`,
                background: `radial-gradient(120% 75% at 50% -15%, rgba(255,255,255,0.09), rgba(255,255,255,0) 56%), linear-gradient(180deg, ${COLORS.frameBg} 0%, ${COLORS.frameBgAlt} 100%)`,
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: DESIGN_WIDTH,
                    height: DESIGN_HEIGHT,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                }}
            >
                <svg
                    width={DESIGN_WIDTH}
                    height={DESIGN_HEIGHT}
                    viewBox={`0 0 ${DESIGN_WIDTH} ${DESIGN_HEIGHT}`}
                    style={{ position: 'absolute', left: 0, top: 0, zIndex: 1 }}
                >
                    <defs>
                        <marker id="memo-arch-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                            <path d="M0,0 L8,4 L0,8 Z" fill={COLORS.line} />
                        </marker>
                    </defs>

                    <path
                        d="M 350 114 C 520 150, 610 176, 710 170"
                        stroke={COLORS.line}
                        strokeWidth="2"
                        fill="none"
                        markerEnd="url(#memo-arch-arrow)"
                    />
                    <text
                        x="510"
                        y="126"
                        fill={COLORS.textMuted}
                        fontSize="12"
                        fontFamily="Inter, system-ui, sans-serif"
                    >
                        tui to core (direct)
                    </text>

                    <path
                        d="M 710 354 L 710 366"
                        stroke={COLORS.line}
                        strokeWidth="2"
                        fill="none"
                        markerEnd="url(#memo-arch-arrow)"
                    />
                    <text
                        x="724"
                        y="360"
                        fill={COLORS.textMuted}
                        fontSize="12"
                        fontFamily="Inter, system-ui, sans-serif"
                    >
                        core to tools
                    </text>

                    <path
                        d="M 890 354 L 890 630"
                        stroke={COLORS.line}
                        strokeWidth="2"
                        fill="none"
                        markerEnd="url(#memo-arch-arrow)"
                    />
                    <text
                        x="902"
                        y="490"
                        fill={COLORS.textMuted}
                        fontSize="12"
                        fontFamily="Inter, system-ui, sans-serif"
                    >
                        all model calls in core
                    </text>
                </svg>

                <Layer
                    y={70}
                    h={92}
                    label="Clients"
                    labelBg="linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))"
                    rowBg={COLORS.panel}
                >
                    <div
                        style={{
                            height: '100%',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                            gap: 12,
                        }}
                    >
                        <MiniCard title="TUI Client" sub="memo / slash commands" />
                        <MiniCard title="Plain Mode" sub="pipes / scripts / --once" />
                        <MiniCard title="Other Entrypoints" sub="init / mcp / skills" highlight />
                    </div>
                </Layer>

                <Layer
                    y={170}
                    h={188}
                    label="Core"
                    labelBg="linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))"
                    rowBg={COLORS.panel}
                >
                    <div
                        style={{
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                        }}
                    >
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                gap: 12,
                            }}
                        >
                            <MiniCard title="Session State Machine" sub="turn lifecycle + history" />
                            <MiniCard title="Prompt & Context Builder" sub="skills + memory + agents" />
                            <MiniCard title="Workspace Runtime" sub="project/session orchestration" />
                        </div>
                        <MiniCard
                            title="Core is Memo's heart: orchestrates tools and ALL LLM calls"
                            sub="providers are OpenAI-compatible; model invocation happens only here"
                            highlight
                        />
                    </div>
                </Layer>

                <Layer
                    y={366}
                    h={162}
                    label="Tools"
                    labelBg="linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))"
                    rowBg={COLORS.panelAlt}
                >
                    <div
                        style={{
                            height: '100%',
                            display: 'grid',
                            gridTemplateColumns: '1.45fr 0.55fr',
                            gap: 14,
                        }}
                    >
                        <div
                            style={{
                                border: `1px solid ${COLORS.border}`,
                                borderRadius: 8,
                                background: 'rgba(255,255,255,0.03)',
                                padding: 10,
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                gap: 10,
                            }}
                        >
                            <MiniCard title="Built-in Tools" sub="exec/read/list/grep/webfetch/apply_patch" />
                            <MiniCard title="MCP Tools" sub="stdio + streamable_http adapters" />
                            <MiniCard title="Tool Router" sub="dispatch and result shaping" />
                            <MiniCard title="Approval Guard" sub="once / session / deny" />
                            <MiniCard title="Sandbox Policy" sub="permission and writable roots" />
                            <MiniCard title="Parallel Dispatch" sub="concurrent tool calls" highlight />
                        </div>
                        <div
                            style={{
                                border: `1px solid ${COLORS.border}`,
                                borderRadius: 8,
                                background: 'rgba(255,255,255,0.03)',
                                padding: 10,
                                display: 'grid',
                                gridTemplateRows: '1fr 1fr',
                                gap: 10,
                            }}
                        >
                            <MiniCard title="Skills" sub="markdown SKILL.md runtime injection" />
                            <MiniCard title="MCP Config" sub="active servers + auth status" />
                        </div>
                    </div>
                </Layer>

                <Layer
                    y={536}
                    h={86}
                    label="Data"
                    labelBg="linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))"
                    rowBg={COLORS.panel}
                >
                    <div
                        style={{
                            height: '100%',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                            gap: 12,
                        }}
                    >
                        <MiniCard title="~/.memo/config.toml" />
                        <MiniCard title="~/.memo/sessions/*.jsonl" />
                        <MiniCard title="~/.memo/Agents.md" />
                        <MiniCard title="Project/User SKILL.md" />
                    </div>
                </Layer>

                <Layer
                    y={630}
                    h={126}
                    label="Models"
                    labelBg="linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))"
                    rowBg={COLORS.panelAlt}
                >
                    <div
                        style={{
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                        }}
                    >
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                gap: 12,
                            }}
                        >
                            <MiniCard title="OpenAI-compatible endpoint" />
                            <MiniCard title="OpenAI / Azure / DeepSeek" />
                            <MiniCard title="Ollama / custom gateway" />
                        </div>
                        <div
                            style={{
                                textAlign: 'center',
                                fontFamily: 'Inter, system-ui, sans-serif',
                                fontSize: 13,
                                color: COLORS.textMuted,
                                fontWeight: 600,
                            }}
                        >
                            Core owns every model request and response normalization.
                        </div>
                    </div>
                </Layer>

                <Layer
                    y={764}
                    h={70}
                    label="Runtime"
                    labelBg="linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))"
                    rowBg={COLORS.panel}
                >
                    <div
                        style={{
                            height: '100%',
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: 20,
                            padding: '0 160px',
                        }}
                    >
                        <MiniCard title="Node.js Process" />
                        <MiniCard title="Local Filesystem + Env" />
                    </div>
                </Layer>

                <div
                    style={{
                        position: 'absolute',
                        left: RIGHT_AUDIT_X,
                        top: 70,
                        width: RIGHT_COL_W,
                        height: 764,
                        borderRadius: 8,
                        border: `1px solid ${COLORS.borderStrong}`,
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04))',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 2,
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 26px rgba(0,0,0,0.35)',
                    }}
                >
                    <div
                        style={{
                            writingMode: 'vertical-rl',
                            textOrientation: 'upright',
                            fontFamily: 'Inter, system-ui, sans-serif',
                            fontSize: 30,
                            letterSpacing: 2,
                            color: COLORS.text,
                            fontWeight: 600,
                        }}
                    >
                        Logs
                    </div>
                </div>

                <div
                    style={{
                        position: 'absolute',
                        left: RIGHT_AUTH_X,
                        top: 70,
                        width: RIGHT_COL_W,
                        height: 764,
                        borderRadius: 8,
                        border: `1px solid ${COLORS.borderStrong}`,
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04))',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 2,
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 26px rgba(0,0,0,0.35)',
                    }}
                >
                    <div
                        style={{
                            writingMode: 'vertical-rl',
                            textOrientation: 'upright',
                            fontFamily: 'Inter, system-ui, sans-serif',
                            fontSize: 30,
                            letterSpacing: 2,
                            color: COLORS.text,
                            fontWeight: 600,
                        }}
                    >
                        Auth
                    </div>
                </div>
            </div>
        </div>
    )
}

export const MemoArchitectureRemotion = MemoArchitectureDiagram
