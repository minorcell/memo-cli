import { readdir } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cache } from 'react'
import type { ReactNode } from 'react'
import { renderMdx } from '@/lib/mdx'

export type DocCategory = 'Getting Started' | 'Core Features' | 'Extensions' | 'Operations'

export type DocSection = {
    id: string
    title: string
    content: ReactNode | null
}

export type DocPageSummary = {
    slug: string
    title: string
    summary: string
    order: number
    category: DocCategory
}

export type DocPage = DocPageSummary & {
    introContent: ReactNode | null
    sections: DocSection[]
}

export type DocsHome = {
    title: string
    content: ReactNode | null
}

type DocFrontmatter = {
    slug: string
    title: string
    description: string
    order: number
    category: DocCategory
}

type ParsedDocFile = {
    meta: DocFrontmatter
    body: string
}

const DOC_CATEGORIES = ['Getting Started', 'Core Features', 'Extensions', 'Operations'] as const
const DOC_CATEGORY_SET = new Set<DocCategory>(DOC_CATEGORIES)
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/

function getDocsDir(locale: string) {
    return resolve(process.cwd(), 'content', 'docs', locale)
}

const USER_GUIDE_FILE = 'README.mdx'

function normalizeDocLinks(markdown: string, locale: string) {
    const localePrefix = locale || 'en'

    return markdown
        .replace(/\]\((?:\.\/)?([a-z0-9-]+)\.mdx?\)/gi, `](/${localePrefix}/docs/$1)`)
        .replace(/\]\(\/docs\/([a-z0-9-]+)\/?\)/gi, `](/${localePrefix}/docs/$1)`)
}

function slugifyHeading(text: string) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[`*_~]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
}

function stripMarkdown(text: string) {
    return text
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/[*_>#~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function extractMarkdownTitle(markdown: string) {
    const normalized = markdown.replace(/\r/g, '').trim()
    const titleLine = normalized.split('\n').find((line) => line.startsWith('# '))
    return titleLine ? titleLine.slice(2).trim() : 'Documentation'
}

function isDocCategory(value: string): value is DocCategory {
    return DOC_CATEGORY_SET.has(value as DocCategory)
}

function getSlugFromFileName(fileName: string) {
    return fileName.replace(/\.(mdx|md)$/i, '')
}

function parseFrontmatterFields(block: string) {
    const fieldMap = new Map<string, string>()

    for (const rawLine of block.split('\n')) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue

        const separatorIndex = line.indexOf(':')
        if (separatorIndex <= 0) continue

        const key = line.slice(0, separatorIndex).trim()
        const value = line
            .slice(separatorIndex + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '')
        fieldMap.set(key, value)
    }

    return fieldMap
}

function parseDocFile(markdown: string, fileName: string): ParsedDocFile {
    const normalized = markdown.replace(/\r/g, '').trim()
    const match = normalized.match(FRONTMATTER_REGEX)

    if (!match) {
        throw new Error(`Missing frontmatter in ${fileName}. Required fields: title, description, order, category.`)
    }

    const fieldMap = parseFrontmatterFields(match[1])
    const title = fieldMap.get('title')
    const description = fieldMap.get('description')
    const orderRaw = fieldMap.get('order')
    const order = Number.parseInt(orderRaw ?? '', 10)
    const categoryRaw = fieldMap.get('category')
    const slugRaw = fieldMap.get('slug')

    if (!title || !description || Number.isNaN(order) || !categoryRaw) {
        throw new Error(`Invalid frontmatter in ${fileName}. Expected title, description, order(number), category.`)
    }

    if (!isDocCategory(categoryRaw)) {
        throw new Error(
            `Invalid doc category in ${fileName}: ${categoryRaw}. Allowed values: ${DOC_CATEGORIES.join(', ')}`,
        )
    }

    const slug = slugRaw?.trim() || getSlugFromFileName(fileName)
    const body = normalized.slice(match[0].length).trim()

    return {
        meta: {
            slug,
            title,
            description,
            order,
            category: categoryRaw,
        },
        body,
    }
}

type SplitDocResult = {
    summary: string
    introMarkdown: string
    sections: Array<{ id: string; title: string; markdown: string }>
}

function splitMarkdownDoc(markdown: string, locale: string): SplitDocResult {
    const normalized = normalizeDocLinks(markdown, locale).replace(/\r/g, '').trim()
    const body = normalized.replace(/^#\s+.+\n*/, '').trim()
    const sectionMatches = [...body.matchAll(/^##\s+(.+)$/gm)]

    if (!sectionMatches.length) {
        const summaryLine = stripMarkdown(
            body
                .split('\n')
                .map((line) => line.trim())
                .find((line) => line.length > 0) ?? '',
        )

        return {
            summary: summaryLine,
            introMarkdown: body,
            sections: [],
        }
    }

    const firstSectionIndex = sectionMatches[0]?.index ?? 0
    const introMarkdown = body.slice(0, firstSectionIndex).trim()

    const usedIds = new Set<string>()
    const sections = sectionMatches.map((match, index) => {
        const sectionTitle = match[1].trim()
        const contentStart = (match.index ?? 0) + match[0].length
        const contentEnd =
            index < sectionMatches.length - 1 ? (sectionMatches[index + 1].index ?? body.length) : body.length
        const sectionMarkdown = body.slice(contentStart, contentEnd).trim()

        let id = slugifyHeading(sectionTitle)
        let uniqueId = id
        let counter = 1
        while (usedIds.has(uniqueId)) {
            uniqueId = `${id}-${counter}`
            counter++
        }
        usedIds.add(uniqueId)

        return {
            id: uniqueId,
            title: sectionTitle,
            markdown: sectionMarkdown,
        }
    })

    const summarySource =
        introMarkdown ||
        sections
            .map((section) => section.markdown)
            .join('\n')
            .trim()
    const summaryLine = stripMarkdown(
        summarySource
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? '',
    )

    return {
        summary: summaryLine,
        introMarkdown,
        sections,
    }
}

const listDocFiles = cache(async (locale: string) => {
    const docsDir = getDocsDir(locale)
    const entries = await readdir(docsDir, { withFileTypes: true })
    return entries
        .filter(
            (entry) =>
                entry.isFile() &&
                /\.(mdx|md)$/i.test(entry.name) &&
                entry.name.toLowerCase() !== USER_GUIDE_FILE.toLowerCase(),
        )
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b))
})

const loadMarkdownFile = cache(async (fileName: string, locale: string) => {
    const docsDir = getDocsDir(locale)
    const fullPath = resolve(docsDir, fileName)
    return readFile(fullPath, 'utf8')
})

const loadDocByFileName = cache(async (fileName: string, locale: string): Promise<DocPage> => {
    const markdown = await loadMarkdownFile(fileName, locale)
    const parsedFile = parseDocFile(markdown, fileName)
    const parsedBody = splitMarkdownDoc(parsedFile.body, locale)
    const summary = parsedFile.meta.description || parsedBody.summary || `Read ${parsedFile.meta.title}`

    const [introContent, sectionContents] = await Promise.all([
        parsedBody.introMarkdown ? renderMdx(parsedBody.introMarkdown) : Promise.resolve(null),
        Promise.all(
            parsedBody.sections.map((section) =>
                section.markdown ? renderMdx(section.markdown) : Promise.resolve(null),
            ),
        ),
    ])

    return {
        slug: parsedFile.meta.slug,
        title: parsedFile.meta.title,
        summary,
        order: parsedFile.meta.order,
        category: parsedFile.meta.category,
        introContent,
        sections: parsedBody.sections.map((section, index) => ({
            id: section.id,
            title: section.title,
            content: sectionContents[index] ?? null,
        })),
    }
})

export const listDocPages = cache(async (locale: string = 'en') => {
    const fileNames = await listDocFiles(locale)
    const docs = await Promise.all(fileNames.map((fileName) => loadDocByFileName(fileName, locale)))

    return docs.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
})

export const getDocPage = cache(async (slug: string, locale: string = 'en') => {
    const pages = await listDocPages(locale)
    return pages.find((page) => page.slug === slug)
})

export async function getDocNeighbors(slug: string, locale: string = 'en') {
    const pages = await listDocPages(locale)
    const index = pages.findIndex((page) => page.slug === slug)
    if (index === -1) {
        return { previous: undefined, next: undefined }
    }

    return {
        previous: index > 0 ? pages[index - 1] : undefined,
        next: index < pages.length - 1 ? pages[index + 1] : undefined,
    }
}

export const getDocsHome = cache(async (locale: string = 'en'): Promise<DocsHome> => {
    const docsDir = getDocsDir(locale)
    const fullPath = resolve(docsDir, USER_GUIDE_FILE)
    const markdown = await readFile(fullPath, 'utf8')
    const parsed = splitMarkdownDoc(markdown, locale)
    const title = extractMarkdownTitle(markdown)

    const mergedMarkdown = [
        parsed.introMarkdown,
        ...parsed.sections.map((section) => `## ${section.title}\n${section.markdown}`),
    ]
        .filter(Boolean)
        .join('\n\n')
        .trim()

    return {
        title,
        content: mergedMarkdown ? await renderMdx(mergedMarkdown) : null,
    }
})
