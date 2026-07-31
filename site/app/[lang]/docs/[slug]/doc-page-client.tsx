'use client'

import { DocsShell } from '@/components/docs-shell'
import type { DocPage as DocPageType, DocPageSummary } from '@/lib/docs'
import enMessages from '@/lib/i18n/messages/en.json'
import zhMessages from '@/lib/i18n/messages/zh.json'
import type { ReactNode } from 'react'

const messagesByLocale: Record<string, typeof enMessages> = {
    en: enMessages,
    zh: zhMessages,
}

interface DocPageClientProps {
    page: DocPageType
    pages: DocPageSummary[]
    neighbors: {
        previous?: DocPageSummary
        next?: DocPageSummary
    }
    lang: string
}

// Simple translation helper
function useTranslations(lang: string) {
    const messages = messagesByLocale[lang] || messagesByLocale.en
    return (key: string): string => {
        const keys = key.split('.')
        let value: unknown = messages
        for (const k of keys) {
            value = (value as Record<string, unknown>)?.[k]
        }
        return (value as string) || key
    }
}

function DocSection({ id, title, content }: { id: string; title: string; content: ReactNode }) {
    return (
        <section id={id} className="doc-section scroll-mt-24 mb-8">
            <h2 className="group flex items-center gap-2 text-xl font-semibold text-[var(--text-primary)] mb-4">
                <a href={`#${id}`} className="hover:underline">
                    {title}
                </a>
                <a
                    href={`#${id}`}
                    className="opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] transition-opacity"
                    aria-label={`Link to ${title}`}
                >
                    #
                </a>
            </h2>
            <div className="doc-section-content prose prose-invert max-w-none">{content}</div>
        </section>
    )
}

export function DocPageClient({ page, pages, neighbors, lang }: DocPageClientProps) {
    const t = useTranslations(lang)

    return (
        <main className="docs-container min-h-screen">
            <DocsShell pages={pages} title={page.title} lang={lang}>
                <div className="mx-auto max-w-[720px]">
                    <article className="doc-article">
                        <header className="mb-8">
                            <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)] md:text-4xl">
                                {page.title}
                            </h1>
                        </header>

                        {page.introContent && <div className="doc-intro mb-8">{page.introContent}</div>}

                        <div className="doc-sections">
                            {page.sections.map((section) => (
                                <DocSection
                                    key={section.id}
                                    id={section.id}
                                    title={section.title}
                                    content={section.content}
                                />
                            ))}
                        </div>

                        {(neighbors.previous || neighbors.next) && (
                            <nav className="mt-12 flex items-center justify-between border-t border-[var(--border-default)] pt-6">
                                {neighbors.previous ? (
                                    <a
                                        href={`/${lang}/docs/${neighbors.previous.slug}/`}
                                        className="group flex flex-col items-start"
                                    >
                                        <span className="text-xs text-[var(--text-tertiary)] mb-1">
                                            {t('docs.previous')}
                                        </span>
                                        <span className="flex items-center gap-1 text-sm font-medium text-[var(--text-primary)] group-hover:underline">
                                            ← {neighbors.previous.title}
                                        </span>
                                    </a>
                                ) : (
                                    <div />
                                )}
                                {neighbors.next ? (
                                    <a
                                        href={`/${lang}/docs/${neighbors.next.slug}/`}
                                        className="group flex flex-col items-end"
                                    >
                                        <span className="text-xs text-[var(--text-tertiary)] mb-1">
                                            {t('docs.next')}
                                        </span>
                                        <span className="flex items-center gap-1 text-sm font-medium text-[var(--text-primary)] group-hover:underline">
                                            {neighbors.next.title} →
                                        </span>
                                    </a>
                                ) : (
                                    <div />
                                )}
                            </nav>
                        )}
                    </article>
                </div>
            </DocsShell>
        </main>
    )
}
