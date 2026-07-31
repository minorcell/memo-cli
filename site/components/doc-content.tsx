'use client'

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type { DocPageSummary } from '@/lib/docs'
import { useT } from './intl-provider'

type DocSection = {
    id: string
    title: string
    content: ReactNode | null
}

type DocContentProps = {
    title: string
    introContent: ReactNode | null
    sections: DocSection[]
    previous?: DocPageSummary
    next?: DocPageSummary
    lang?: string
}

export function DocContent({ title, introContent, sections, previous, next, lang = 'en' }: DocContentProps) {
    const t = useT()

    return (
        <article className="doc-article">
            <header className="mb-8">
                <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)] md:text-4xl">
                    {title}
                </h1>
            </header>

            {introContent ? <div className="doc-intro mb-8">{introContent}</div> : null}

            <div className="doc-sections">
                {sections.map((section) => (
                    <section key={section.id} id={section.id} className="doc-section scroll-mt-24 mb-8">
                        <h2 className="group flex items-center gap-2 text-xl font-semibold text-[var(--text-primary)] mb-4">
                            <a href={`#${section.id}`} className="hover:underline">
                                {section.title}
                            </a>
                            <a
                                href={`#${section.id}`}
                                className="opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] transition-opacity"
                                aria-label={`Link to ${section.title}`}
                            >
                                #
                            </a>
                        </h2>
                        {section.content ? (
                            <div className="doc-section-content prose prose-invert max-w-none">{section.content}</div>
                        ) : null}
                    </section>
                ))}
            </div>

            {(previous || next) && (
                <nav className="mt-12 flex items-center justify-between border-t border-[var(--border-default)] pt-6">
                    {previous ? (
                        <Link href={`/${lang}/docs/${previous.slug}`} className="group flex flex-col items-start">
                            <span className="text-xs text-[var(--text-tertiary)] mb-1">{t('docs.previous')}</span>
                            <span className="flex items-center gap-1 text-sm font-medium text-[var(--text-primary)] group-hover:underline">
                                <ChevronRight className="h-4 w-4 rotate-180" />
                                {previous.title}
                            </span>
                        </Link>
                    ) : (
                        <div />
                    )}
                    {next ? (
                        <Link href={`/${lang}/docs/${next.slug}`} className="group flex flex-col items-end">
                            <span className="text-xs text-[var(--text-tertiary)] mb-1">{t('docs.next')}</span>
                            <span className="flex items-center gap-1 text-sm font-medium text-[var(--text-primary)] group-hover:underline">
                                {next.title}
                                <ChevronRight className="h-4 w-4" />
                            </span>
                        </Link>
                    ) : (
                        <div />
                    )}
                </nav>
            )}
        </article>
    )
}
