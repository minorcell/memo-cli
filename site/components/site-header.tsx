'use client'

import Image from 'next/image'
import { Github, Package, Menu, X, BookOpen, NotebookPen } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { LocaleSwitcher } from './locale-switcher'
import { useT } from './intl-provider'

const GITHUB_URL = 'https://github.com/minorcell/memo-code'
const NPM_URL = 'https://www.npmjs.com/package/@memo-code/memo'
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export function SiteHeader({ lang }: { lang: string }) {
    const t = useT()
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const homeHref = `/${lang}`
    const docsHref = `/${lang}/docs`
    const blogHref = `/${lang}/blog`
    const gettingStartedHref = `${docsHref}/getting-started`

    const navItems = [
        { href: docsHref, label: t('nav.docs'), icon: BookOpen },
        { href: blogHref, label: t('nav.blog'), icon: NotebookPen },
    ]

    return (
        <header className="sticky top-0 z-50 px-4 pt-3 md:px-8">
            <div className="mx-auto max-w-6xl">
                <nav className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-2.5">
                    {/* Logo */}
                    <Link href={homeHref} className="group flex items-center gap-3">
                        <div className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] transition-colors group-hover:border-[var(--border-hover)]">
                            <Image
                                src={`${basePath}/logo-dark.svg`}
                                width={24}
                                height={24}
                                alt="Memo Logo"
                                className="rounded"
                            />
                        </div>
                        <div className="hidden sm:block">
                            <p className="text-sm font-semibold tracking-tight text-white">Memo</p>
                            <p className="-mt-0.5 text-[10px] text-[var(--text-tertiary)]">Coding Agent</p>
                        </div>
                    </Link>

                    {/* Desktop Navigation */}
                    <div className="hidden items-center gap-1 md:flex">
                        {navItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                            >
                                <item.icon className="h-4 w-4" />
                                {item.label}
                            </Link>
                        ))}
                    </div>

                    {/* Right side actions */}
                    <div className="flex items-center gap-2">
                        <LocaleSwitcher lang={lang} />
                        <a
                            href={GITHUB_URL}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="GitHub"
                            className="hidden h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] sm:flex"
                        >
                            <Github className="h-4 w-4" />
                        </a>
                        <a
                            href={NPM_URL}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="npm"
                            className="hidden h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] sm:flex"
                        >
                            <Package className="h-4 w-4" />
                        </a>

                        <Link
                            href={gettingStartedHref}
                            className="hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)] md:block"
                        >
                            {t('home.cta.getStarted')}
                        </Link>

                        {/* Mobile menu button */}
                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] md:hidden"
                            aria-label="Toggle menu"
                        >
                            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                        </button>
                    </div>
                </nav>

                {/* Mobile menu */}
                {mobileMenuOpen && (
                    <div className="mt-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2 md:hidden">
                        {navItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className="flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                            >
                                <item.icon className="h-4 w-4" />
                                {item.label}
                            </Link>
                        ))}
                        <div className="mt-2 border-t border-[var(--border-default)] pt-2">
                            <Link
                                href={gettingStartedHref}
                                onClick={() => setMobileMenuOpen(false)}
                                className="flex items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]"
                            >
                                {t('home.cta.getStarted')}
                            </Link>
                        </div>
                        <div className="mt-2 flex gap-2 border-t border-[var(--border-default)] pt-2">
                            <a
                                href={GITHUB_URL}
                                target="_blank"
                                rel="noreferrer"
                                className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)]"
                            >
                                <Github className="h-4 w-4" />
                                GitHub
                            </a>
                            <a
                                href={NPM_URL}
                                target="_blank"
                                rel="noreferrer"
                                className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)]"
                            >
                                <Package className="h-4 w-4" />
                                npm
                            </a>
                        </div>
                    </div>
                )}
            </div>
        </header>
    )
}
