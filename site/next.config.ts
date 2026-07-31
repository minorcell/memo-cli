import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const currentDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(currentDir, '..')
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? ''
const isGithubPagesBuild = process.env.GITHUB_ACTIONS === 'true' && repository.length > 0
const explicitBasePath = process.env.NEXT_PUBLIC_BASE_PATH
const pageBasePath = explicitBasePath !== undefined ? explicitBasePath : isGithubPagesBuild ? `/${repository}` : ''

const nextConfig: NextConfig = {
    output: 'export',
    basePath: pageBasePath,
    assetPrefix: pageBasePath,
    trailingSlash: true,
    env: {
        NEXT_PUBLIC_BASE_PATH: pageBasePath,
    },
    images: {
        unoptimized: true,
    },
    outputFileTracingRoot: workspaceRoot,
    turbopack: {
        root: workspaceRoot,
    },
}

export default nextConfig
