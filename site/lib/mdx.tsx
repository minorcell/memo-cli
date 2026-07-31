import type { ComponentType, ReactNode } from 'react'
import { compileMDX } from 'next-mdx-remote/rsc'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { McpCacheSWRDiagram } from '@/content/blog/components/mcp-cache-swr-diagram'
import { ToolSystemArchitectureDiagram } from '@/content/blog/components/tool-system-architecture-diagram'

type MdxComponentMap = Record<string, ComponentType<unknown>>

const baseMdxComponents: MdxComponentMap = {
    McpCacheSWRDiagram,
    ToolSystemArchitectureDiagram,
}

export async function renderMdx(source: string, overrides: MdxComponentMap = {}): Promise<ReactNode> {
    const { content } = await compileMDX({
        source,
        options: {
            parseFrontmatter: false,
            mdxOptions: {
                remarkPlugins: [remarkGfm],
                rehypePlugins: [[rehypeHighlight, { ignoreMissing: true }]],
            },
        },
        components: {
            ...baseMdxComponents,
            ...overrides,
        },
    })

    return content
}
