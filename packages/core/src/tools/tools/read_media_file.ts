import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { tool } from 'ai'
import { textResult } from '@memo/core/tools/tools/mcp'
import { validatePath } from '@memo/core/tools/tools/filesystem/lib'
import { resolveAllowedDirectories } from '@memo/core/tools/tools/filesystem/roots'

const READ_MEDIA_FILE_INPUT_SCHEMA = z
    .object({
        path: z.string().min(1),
    })
    .strict()

const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
}

export const readMediaFileTool = tool({
    description: 'Read an image or audio file and return base64 payload metadata as JSON text.',
    inputSchema: READ_MEDIA_FILE_INPUT_SCHEMA,
    metadata: { memo: { supportsParallelToolCalls: true, isMutating: false } },

    execute: async (input) => {
        try {
            const allowedDirectories = await resolveAllowedDirectories()
            const validPath = await validatePath(input.path, allowedDirectories)

            const extension = path.extname(validPath).toLowerCase()
            const mimeType = MIME_TYPES[extension] ?? 'application/octet-stream'
            const data = (await readFile(validPath)).toString('base64')

            const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'blob'

            return textResult(JSON.stringify({ type, mimeType, data }))
        } catch (err) {
            return textResult(`read_media_file failed: ${(err as Error).message}`, true)
        }
    },
})
