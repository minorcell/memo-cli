import { listDocPages, getDocPage, getDocNeighbors } from '@/lib/docs'
import { DocPageClient } from './doc-page-client'

export async function generateStaticParams() {
    const { locales } = await import('@/lib/i18n/config')
    const params: Array<{ lang: string; slug: string }> = []

    for (const locale of locales) {
        const pages = await listDocPages(locale)
        for (const page of pages) {
            params.push({ lang: locale, slug: page.slug })
        }
    }

    return params
}

export default async function DocPage({ params }: { params: Promise<{ lang: string; slug: string }> }) {
    const { lang, slug } = await params
    const [page, pages, neighbors] = await Promise.all([
        getDocPage(slug, lang),
        listDocPages(lang),
        getDocNeighbors(slug, lang),
    ])

    if (!page) {
        return <div>Page not found</div>
    }

    return <DocPageClient page={page} pages={pages} neighbors={neighbors} lang={lang} />
}
