import { listBlogPosts, getBlogPost } from '@/lib/blog'
import { BlogPostClient } from './blog-post-client'

export async function generateStaticParams() {
    const { locales } = await import('@/lib/i18n/config')
    const params: Array<{ lang: string; slug: string }> = []

    for (const locale of locales) {
        const posts = await listBlogPosts(locale)
        for (const post of posts) {
            params.push({ lang: locale, slug: post.slug })
        }
    }

    return params
}

export default async function BlogPostPage({ params }: { params: Promise<{ lang: string; slug: string }> }) {
    const { lang, slug } = await params
    const post = await getBlogPost(slug, lang)

    if (!post) {
        return <div>Post not found</div>
    }

    return (
        <BlogPostClient
            post={{
                slug: post.slug,
                title: post.title,
                summary: post.summary,
                publishedAt: post.publishedAt,
                order: post.order,
            }}
            content={post.content}
            lang={lang}
        />
    )
}
