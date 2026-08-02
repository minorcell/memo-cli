'use client'

import Image from 'next/image'
import { SiteHeader } from '@/components/site-header'
import { MemoHeroRemotion } from '@/components/memo-hero-remotion'
import { MemoArchitectureDiagram } from '@/components/memo-architecture-remotion'
import { ArrowRight, Terminal, Cpu, Shield, GitBranch, Sparkles, Zap } from 'lucide-react'
import Link from 'next/link'

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export function HomeClient({
    lang,
    messages,
}: {
    lang: string
    messages: typeof import('@/lib/i18n/messages/en.json')
}) {
    const docsHref = `/${lang}/docs`
    const blogHref = `/${lang}/blog`
    const gettingStartedHref = `${docsHref}/getting-started`

    const t = (key: string): string => {
        const keys = key.split('.')
        let value: unknown = messages
        for (const k of keys) {
            value = (value as Record<string, unknown>)?.[k]
        }
        return (value as string) || key
    }

    const features = [
        {
            icon: Terminal,
            titleKey: 'home.features.items.terminalNative.title',
            descKey: 'home.features.items.terminalNative.description',
        },
        {
            icon: Sparkles,
            titleKey: 'home.features.items.liveReasoning.title',
            descKey: 'home.features.items.liveReasoning.description',
        },
        {
            icon: Shield,
            titleKey: 'home.features.items.security.title',
            descKey: 'home.features.items.security.description',
        },
        {
            icon: GitBranch,
            titleKey: 'home.features.items.mcpReady.title',
            descKey: 'home.features.items.mcpReady.description',
        },
        {
            icon: Zap,
            titleKey: 'home.features.items.skills.title',
            descKey: 'home.features.items.skills.description',
        },
        {
            icon: Cpu,
            titleKey: 'home.features.items.builtInTools.title',
            descKey: 'home.features.items.builtInTools.description',
        },
    ]

    const workflowSteps = [
        {
            step: '01',
            titleKey: 'home.quickstart.steps.install.title',
            code: 'npm install -g @memo-code/memo',
            descKey: 'home.quickstart.steps.install.description',
        },
        {
            step: '02',
            titleKey: 'home.quickstart.steps.configure.title',
            code: 'export OPENAI_API_KEY=sk-...',
            descKey: 'home.quickstart.steps.configure.description',
        },
        {
            step: '03',
            titleKey: 'home.quickstart.steps.launch.title',
            code: 'memo',
            descKey: 'home.quickstart.steps.launch.description',
        },
    ]

    return (
        <div className="relative min-h-screen bg-[var(--bg-primary)]">
            <SiteHeader lang={lang} />

            <main className="relative z-10 pb-16">
                <section className="border-b border-[var(--border-default)] px-4 pb-20 pt-14 md:px-8 md:pb-24 md:pt-20">
                    <div className="mx-auto max-w-6xl">
                        <div className="inline-flex items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
                            {t('home.badge')}
                        </div>

                        <h1 className="mt-8 max-w-5xl text-4xl font-semibold tracking-tight text-[var(--text-primary)] md:text-6xl">
                            {t('home.title')}
                        </h1>
                        <p className="mt-5 max-w-3xl text-lg text-[var(--text-secondary)]">{t('home.subtitle')}</p>

                        <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row">
                            <Link href={gettingStartedHref} className="btn-primary min-w-[160px]">
                                {t('home.cta.getStarted')}
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                            <a
                                href="https://github.com/minorcell/memo-code"
                                target="_blank"
                                rel="noreferrer"
                                className="btn-secondary min-w-[160px]"
                            >
                                {t('home.cta.viewOnGithub')}
                            </a>
                        </div>

                        <div className="mt-12 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                            <MemoHeroRemotion />
                        </div>
                    </div>
                </section>

                <section className="border-b border-[var(--border-default)] px-4 py-16 md:px-8 md:py-20">
                    <div className="mx-auto max-w-6xl">
                        <h2 className="text-2xl font-semibold text-[var(--text-primary)] md:text-3xl">
                            {t('home.features.title')}
                        </h2>
                        <p className="mt-3 max-w-2xl text-[var(--text-secondary)]">{t('home.features.subtitle')}</p>

                        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {features.map((feature) => (
                                <div
                                    key={feature.titleKey}
                                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5"
                                >
                                    <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                                        <feature.icon className="h-4 w-4" />
                                    </div>
                                    <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
                                        {t(feature.titleKey)}
                                    </h3>
                                    <p className="mt-2 text-sm text-[var(--text-secondary)]">{t(feature.descKey)}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="border-b border-[var(--border-default)] px-4 py-16 md:px-8 md:py-20">
                    <div className="mx-auto max-w-6xl">
                        <div className="badge">{t('home.architecture.badge')}</div>
                        <h2 className="mt-4 max-w-4xl text-2xl font-semibold text-[var(--text-primary)] md:text-3xl">
                            {t('home.architecture.title')}
                        </h2>
                        <p className="mt-3 max-w-3xl text-[var(--text-secondary)]">{t('home.architecture.subtitle')}</p>

                        <div className="mt-8 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                            <MemoArchitectureDiagram />
                        </div>
                    </div>
                </section>

                <section className="border-b border-[var(--border-default)] px-4 py-16 md:px-8 md:py-20">
                    <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
                        <div>
                            <div className="badge">{t('home.quickstart.badge')}</div>
                            <h2 className="mt-4 text-2xl font-semibold text-[var(--text-primary)] md:text-3xl">
                                {t('home.quickstart.title')}
                            </h2>
                            <p className="mt-3 max-w-xl text-[var(--text-secondary)]">
                                {t('home.quickstart.subtitle')}
                            </p>

                            <div className="mt-7 space-y-5">
                                {workflowSteps.map((item) => (
                                    <div key={item.step} className="flex gap-3">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] text-xs font-semibold text-[var(--text-secondary)]">
                                            {item.step}
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                                                {t(item.titleKey)}
                                            </h3>
                                            <p className="text-sm text-[var(--text-secondary)]">{t(item.descKey)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                            <div className="border-b border-[var(--border-default)] px-4 py-2 text-xs text-[var(--text-tertiary)]">
                                {t('home.quickstart.terminal.label')}
                            </div>
                            <div className="space-y-4 p-5 font-mono text-sm">
                                {workflowSteps.map((item) => (
                                    <div key={item.step}>
                                        <p className="text-[var(--text-tertiary)]"># {t(item.titleKey)}</p>
                                        <p className="text-[var(--text-primary)]">
                                            <span className="text-[var(--text-secondary)]">$</span> {item.code}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="px-4 py-16 md:px-8 md:py-20">
                    <div className="mx-auto max-w-4xl rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-6 py-8 text-center md:px-10">
                        <h2 className="text-2xl font-semibold text-[var(--text-primary)] md:text-3xl">
                            {t('home.ctaSection.title')}
                        </h2>
                        <p className="mx-auto mt-3 max-w-xl text-[var(--text-secondary)]">
                            {t('home.ctaSection.subtitle')}
                        </p>
                        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                            <Link href={gettingStartedHref} className="btn-primary min-w-[180px]">
                                {t('home.ctaSection.readDocs')}
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                            <a
                                href="https://www.npmjs.com/package/@memo-code/memo"
                                target="_blank"
                                rel="noreferrer"
                                className="btn-secondary min-w-[180px]"
                            >
                                {t('home.ctaSection.npmInstall')}
                            </a>
                        </div>
                    </div>
                </section>

                <footer className="border-t border-[var(--border-default)] px-4 pt-10 md:px-8">
                    <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 md:flex-row">
                        <div className="flex items-center gap-3">
                            <Image
                                src={`${basePath}/logo-dark.svg`}
                                width={28}
                                height={28}
                                alt="Memo Logo"
                                className="rounded-md"
                            />
                            <span className="text-sm font-semibold text-[var(--text-primary)]">Memo Code</span>
                        </div>
                        <div className="flex gap-6 text-sm text-[var(--text-secondary)]">
                            <Link href={docsHref} className="transition-colors hover:text-[var(--text-primary)]">
                                {t('nav.docs')}
                            </Link>
                            <Link href={blogHref} className="transition-colors hover:text-[var(--text-primary)]">
                                {t('nav.blog')}
                            </Link>
                            <a
                                href="https://github.com/minorcell/memo-code"
                                target="_blank"
                                rel="noreferrer"
                                className="transition-colors hover:text-[var(--text-primary)]"
                            >
                                {t('nav.github')}
                            </a>
                            <a
                                href="https://www.npmjs.com/package/@memo-code/memo"
                                target="_blank"
                                rel="noreferrer"
                                className="transition-colors hover:text-[var(--text-primary)]"
                            >
                                {t('nav.npm')}
                            </a>
                        </div>
                        <p className="text-xs text-[var(--text-tertiary)]">{t('home.footer.copyright')}</p>
                    </div>
                </footer>
            </main>
        </div>
    )
}
