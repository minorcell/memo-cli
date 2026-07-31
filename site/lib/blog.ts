import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cache } from 'react'
import type { ReactNode } from 'react'
import { renderMdx } from '@/lib/mdx'

export type BlogPostSummary = {
    slug: string
    title: string
    summary: string
    publishedAt: string
    order: number
}

export type BlogPost = BlogPostSummary & {
    content: ReactNode
}

type BlogFrontmatter = {
    title: string
    description: string
    date: string
    order: number
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/
const MARKDOWN_EXTENSIONS = ['.mdx', '.md'] as const

function getBlogDir(locale: string) {
    return resolve(process.cwd(), 'content', 'blog', locale)
}

function parseFrontmatter(markdown: string, slug: string) {
    const normalized = markdown.replace(/\r/g, '').trim()
    const match = normalized.match(FRONTMATTER_REGEX)
    if (!match) {
        throw new Error(`Missing frontmatter in blog post: ${slug}. Required fields: title, description, date, order.`)
    }

    const frontmatter = match[1]
    const body = normalized.slice(match[0].length).trim()
    const fieldMap = new Map<string, string>()

    for (const rawLine of frontmatter.split('\n')) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const separatorIndex = line.indexOf(':')
        if (separatorIndex <= 0) continue

        const key = line.slice(0, separatorIndex).trim()
        const value = line
            .slice(separatorIndex + 1)
            .trim()
            .replace(/^["']|["']$/g, '')
        fieldMap.set(key, value)
    }

    const title = fieldMap.get('title')
    const description = fieldMap.get('description')
    const date = fieldMap.get('date')
    const orderRaw = fieldMap.get('order')
    const order = Number.parseInt(orderRaw ?? '', 10)

    if (!title || !description || !date || Number.isNaN(order)) {
        throw new Error(`Invalid frontmatter in ${slug}. Expected title, description, date(YYYY-MM-DD), order(number).`)
    }

    return {
        meta: {
            title,
            description,
            date,
            order,
        } satisfies BlogFrontmatter,
        body,
    }
}

function removeDuplicateTitleHeading(body: string, title: string) {
    const firstHeading = body.match(/^#\s+(.+)\n+/)
    if (!firstHeading) return body
    if (firstHeading[1].trim() !== title.trim()) return body

    return body.slice(firstHeading[0].length).trim()
}

function isMarkdownEntry(fileName: string) {
    return MARKDOWN_EXTENSIONS.some((extension) => fileName.endsWith(extension))
}

function getSlugFromFileName(fileName: string) {
    return fileName.replace(/\.(mdx|md)$/i, '')
}

const listMarkdownFiles = cache(async (locale: string) => {
    const blogDir = getBlogDir(locale)
    const entries = await readdir(blogDir, { withFileTypes: true })
    return entries
        .filter((entry) => entry.isFile() && isMarkdownEntry(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b))
})

const loadMarkdownFile = cache(async (fileName: string, locale: string) => {
    const blogDir = getBlogDir(locale)
    const fullPath = resolve(blogDir, fileName)
    return readFile(fullPath, 'utf8')
})

const loadPostByFileName = cache(async (fileName: string, locale: string): Promise<BlogPost> => {
    const slug = getSlugFromFileName(fileName)
    const markdown = await loadMarkdownFile(fileName, locale)
    const parsed = parseFrontmatter(markdown, slug)
    const contentBody = removeDuplicateTitleHeading(parsed.body, parsed.meta.title)

    return {
        slug,
        title: parsed.meta.title,
        summary: parsed.meta.description,
        publishedAt: parsed.meta.date,
        order: parsed.meta.order,
        content: await renderMdx(contentBody),
    }
})

export const listBlogPosts = cache(async (locale: string = 'en'): Promise<BlogPostSummary[]> => {
    const fileNames = await listMarkdownFiles(locale)
    const posts = await Promise.all(fileNames.map((fileName) => loadPostByFileName(fileName, locale)))
    return posts
        .sort((a, b) => b.order - a.order || b.publishedAt.localeCompare(a.publishedAt))
        .map(({ slug, title, summary, publishedAt, order }) => ({
            slug,
            title,
            summary,
            publishedAt,
            order,
        }))
})

export const getBlogPost = cache(async (slug: string, locale: string = 'en') => {
    const fileNames = await listMarkdownFiles(locale)
    const fileName = fileNames.find((name) => getSlugFromFileName(name) === slug)
    if (!fileName) return undefined
    return loadPostByFileName(fileName, locale)
})
