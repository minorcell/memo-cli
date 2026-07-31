import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-inter',
})

const jetbrainsMono = JetBrains_Mono({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-mono',
})

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const metadata: Metadata = {
    title: {
        default: 'Memo CLI - AI Coding Agent for Terminal',
        template: '%s | Memo CLI',
    },
    description:
        'Memo is a lightweight, open-source coding agent that runs in your terminal. Code faster with AI assistance through natural language.',
    keywords: ['CLI', 'AI', 'coding agent', 'terminal', 'developer tools', 'productivity'],
    authors: [{ name: 'Memo Team' }],
    openGraph: {
        title: 'Memo CLI - AI Coding Agent for Terminal',
        description: 'A lightweight, open-source coding agent that understands your project context.',
        type: 'website',
        siteName: 'Memo CLI',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Memo CLI - AI Coding Agent for Terminal',
        description: 'Code faster with AI assistance in your terminal.',
    },
    icons: {
        icon: `${basePath}/logo.svg`,
        shortcut: `${basePath}/logo.svg`,
        apple: `${basePath}/logo.svg`,
    },
    metadataBase: new URL('https://minorcell.github.io/memo-cli'),
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
            <body className="bg-[var(--bg-primary)]">{children}</body>
        </html>
    )
}
