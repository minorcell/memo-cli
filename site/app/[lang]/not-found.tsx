'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useT } from '@/components/intl-provider'

export default function NotFound() {
    const t = useT()
    const params = useParams<{ lang?: string }>()
    const homeHref = `/${params.lang ?? 'en'}`

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-primary)] px-4">
            <div className="text-center">
                <h1 className="text-6xl font-bold text-[var(--text-primary)]">404</h1>
                <h2 className="mt-4 text-2xl font-semibold text-[var(--text-primary)]">{t('notFound.title')}</h2>
                <p className="mt-2 text-[var(--text-secondary)]">{t('notFound.description')}</p>
                <Link
                    href={homeHref}
                    className="mt-6 inline-block rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-6 py-3 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)]"
                >
                    {t('notFound.backHome')}
                </Link>
            </div>
        </div>
    )
}
