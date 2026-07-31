'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import enMessages from '@/lib/i18n/messages/en.json'
import zhMessages from '@/lib/i18n/messages/zh.json'
import type { ReactNode } from 'react'

const messagesByLocale: Record<string, typeof enMessages> = {
    en: enMessages,
    zh: zhMessages,
}

function formatDate(date: string, locale: string) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
    })
}

interface BlogPostClientProps {
    post: {
        slug: string
        title: string
        summary: string
        publishedAt: string
        order: number
    }
    content: ReactNode
    lang: string
}

export function BlogPostClient({ post, content, lang }: BlogPostClientProps) {
    const messages = messagesByLocale[lang] || messagesByLocale.en
    const homeHref = `/${lang}`
    const blogHref = `/${lang}/blog`

    return (
        <main className="docs-container min-h-screen">
            <div className="mx-auto w-full max-w-[1000px] px-4 pb-20 pt-6 md:px-8">
                <nav className="mb-6 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                    <Link href={homeHref} className="transition-colors hover:text-[var(--text-primary)]">
                        {messages.blog.breadcrumb.home}
                    </Link>
                    <span>/</span>
                    <Link href={blogHref} className="transition-colors hover:text-[var(--text-primary)]">
                        {messages.blog.title}
                    </Link>
                    <span>/</span>
                    <span className="truncate text-[var(--text-primary)]">{post.title}</span>
                </nav>

                <article className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-6 py-7 md:px-8 md:py-8">
                    <header className="mb-8 border-b border-[var(--border-default)] pb-6">
                        <p className="text-xs text-[var(--text-tertiary)]">{formatDate(post.publishedAt, lang)}</p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text-primary)] md:text-4xl">
                            {post.title}
                        </h1>
                        <p className="mt-3 max-w-3xl text-base text-[var(--text-secondary)]">{post.summary}</p>
                    </header>

                    <div className="doc-prose">{content}</div>
                </article>

                <div className="mt-4">
                    <Link
                        href={blogHref}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {messages.blog.title}
                    </Link>
                </div>
            </div>
        </main>
    )
}
