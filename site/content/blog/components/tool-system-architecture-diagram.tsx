'use client'

import { useEffect, useRef, useState } from 'react'

const DESIGN_WIDTH = 1360
const DESIGN_HEIGHT = 840
const FRAME = {
    x: 56,
    y: 108,
    w: 1248,
    h: 676,
}

const CARD = {
    x: 84,
    h: 176,
    gap: 26,
}

const layers = [
    {
        title: '编排层 (Orchestrator)',
        lines: ['入参校验 -> 审批拦截 -> 结果裁剪 -> 错误归类', '统一处理工具调用生命周期'],
    },
    {
        title: '风险与审批层 (Approval)',
        lines: ['风险分级 -> 审批策略 -> 决策缓存', '按 read/write/execute 控制拦截强度'],
    },
    {
        title: '工具定义层 (Definition)',
        lines: ['声明式 DSL -> Schema 校验 -> 并发能力标记', '能力描述与执行逻辑解耦'],
    },
]

export function ToolSystemArchitectureDiagram() {
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
            className="my-6 overflow-hidden rounded-xl border border-[var(--border-default)]"
            style={{
                position: 'relative',
                width: '100%',
                aspectRatio: `${DESIGN_WIDTH} / ${DESIGN_HEIGHT}`,
                background: '#090b12',
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
                <div
                    style={{
                        position: 'absolute',
                        left: 56,
                        top: 42,
                        display: 'inline-flex',
                        alignItems: 'center',
                        border: '1px solid rgba(255,255,255,0.18)',
                        borderRadius: 999,
                        padding: '4px 12px',
                        color: '#a1a1aa',
                        background: 'rgba(17,17,19,0.9)',
                        fontSize: 12,
                        fontWeight: 620,
                        letterSpacing: 0.24,
                        fontFamily: 'Inter, system-ui, sans-serif',
                    }}
                >
                    TOOL SYSTEM ARCHITECTURE
                </div>

                <div
                    style={{
                        position: 'absolute',
                        left: FRAME.x,
                        top: FRAME.y,
                        width: FRAME.w,
                        height: FRAME.h,
                        border: '1px dashed rgba(255,255,255,0.35)',
                        borderRadius: 20,
                        padding: '20px',
                        background: 'transparent',
                    }}
                >
                    {layers.map((layer, index) => {
                        const top = 24 + index * (CARD.h + CARD.gap)
                        return (
                            <div
                                key={layer.title}
                                style={{
                                    position: 'absolute',
                                    left: CARD.x,
                                    right: CARD.x,
                                    top,
                                    height: CARD.h,
                                    borderRadius: 16,
                                    border: '1px dashed rgba(255,255,255,0.28)',
                                    background: '#11151d',
                                    overflow: 'hidden',
                                }}
                            >
                                <div style={{ padding: '20px 24px 18px 24px' }}>
                                    <div
                                        style={{
                                            color: '#f4f4f5',
                                            fontFamily: 'Inter, system-ui, sans-serif',
                                            fontWeight: 650,
                                            fontSize: 34,
                                            letterSpacing: -0.42,
                                        }}
                                    >
                                        {layer.title}
                                    </div>

                                    {layer.lines.map((line) => (
                                        <div
                                            key={line}
                                            style={{
                                                marginTop: 12,
                                                color: '#cbd5e1',
                                                fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
                                                fontSize: 18,
                                                fontWeight: 500,
                                                lineHeight: 1.45,
                                            }}
                                        >
                                            {line}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    })}

                    {[0, 1].map((index) => {
                        const y = 24 + (index + 1) * CARD.h + index * CARD.gap
                        return (
                            <div
                                key={`connector-${index}`}
                                style={{
                                    position: 'absolute',
                                    left: FRAME.w / 2,
                                    top: y,
                                    width: 2,
                                    height: CARD.gap,
                                    background: 'rgba(148, 163, 184, 0.8)',
                                }}
                            />
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
