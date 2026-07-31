import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { locales, defaultLocale } from '@/lib/i18n/config'
import type { Locale } from '@/lib/i18n/config'
import enMessages from '@/lib/i18n/messages/en.json'
import zhMessages from '@/lib/i18n/messages/zh.json'
import { IntlProvider } from '@/components/intl-provider'

const messagesByLocale: Record<Locale, typeof enMessages> = {
    en: enMessages,
    zh: zhMessages,
}

export function generateStaticParams() {
    return locales.map((locale) => ({ lang: locale }))
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
    const { lang } = await params
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

    const titles: Record<Locale, string> = {
        en: 'Memo CLI - AI Coding Agent for Terminal',
        zh: 'Memo CLI - 终端 AI 编程助手',
    }

    const descriptions: Record<Locale, string> = {
        en: 'Memo is a lightweight, open-source coding agent that runs in your terminal. Code faster with AI assistance through natural language.',
        zh: 'Memo 是一个轻量级开源编程助手，直接在终端中运行。通过自然语言获得 AI 辅助，更快地编写代码。',
    }

    return {
        title: {
            default: titles[lang as Locale] ?? titles[defaultLocale],
            template: '%s | Memo CLI',
        },
        description: descriptions[lang as Locale] ?? descriptions[defaultLocale],
        keywords: ['CLI', 'AI', 'coding agent', 'terminal', 'developer tools', 'productivity'],
        authors: [{ name: 'Memo Team' }],
        openGraph: {
            title: titles[lang as Locale] ?? titles[defaultLocale],
            description: descriptions[lang as Locale] ?? descriptions[defaultLocale],
            type: 'website',
            siteName: 'Memo CLI',
        },
        twitter: {
            card: 'summary_large_image',
            title: titles[lang as Locale] ?? titles[defaultLocale],
            description: descriptions[lang as Locale] ?? descriptions[defaultLocale],
        },
        icons: {
            icon: `${basePath}/logo.svg`,
            shortcut: `${basePath}/logo.svg`,
            apple: `${basePath}/logo.svg`,
        },
        metadataBase: new URL('https://minorcell.github.io/memo-cli'),
    }
}

export default async function LangLayout({
    children,
    params,
}: Readonly<{
    children: React.ReactNode
    params: Promise<{ lang: string }>
}>) {
    const { lang } = await params

    if (!locales.includes(lang as Locale)) {
        notFound()
    }

    const messages = messagesByLocale[lang as Locale]

    return (
        <IntlProvider messages={messages} locale={lang}>
            {children}
        </IntlProvider>
    )
}
