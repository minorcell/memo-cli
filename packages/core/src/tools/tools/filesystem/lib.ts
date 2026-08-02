import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createTwoFilesPatch } from 'diff'
import { minimatch } from 'minimatch'
import { expandHome, normalizePath } from './path-utils'
import { isPathWithinAllowedDirectories } from './path-validation'

export interface FileInfo {
    size: number
    created: Date
    modified: Date
    accessed: Date
    isDirectory: boolean
    isFile: boolean
    permissions: string
}

export interface SearchOptions {
    excludePatterns?: string[]
}

interface FileEdit {
    oldText: string
    newText: string
}

const MAX_FILE_READ_BYTES = 50 * 1024 * 1024

export function formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    if (bytes === 0) return '0 B'

    const index = Math.floor(Math.log(bytes) / Math.log(1024))

    if (index <= 0) return `${bytes} ${units[0]}`

    const unitIndex = Math.min(index, units.length - 1)
    return `${(bytes / Math.pow(1024, unitIndex)).toFixed(2)} ${units[unitIndex]}`
}

export function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n')
}

export function createUnifiedDiff(originalContent: string, newContent: string, filepath = 'file'): string {
    const normalizedOriginal = normalizeLineEndings(originalContent)
    const normalizedNew = normalizeLineEndings(newContent)

    return createTwoFilesPatch(filepath, filepath, normalizedOriginal, normalizedNew, 'original', 'modified')
}

function resolveRelativePathAgainstAllowedDirectories(relativePath: string, allowedDirectories: string[]): string {
    if (allowedDirectories.length === 0) {
        return path.resolve(process.cwd(), relativePath)
    }

    for (const allowedDir of allowedDirectories) {
        const candidate = path.resolve(allowedDir, relativePath)
        const normalizedCandidate = normalizePath(candidate)

        if (isPathWithinAllowedDirectories(normalizedCandidate, allowedDirectories)) {
            return candidate
        }
    }

    return path.resolve(allowedDirectories[0], relativePath)
}

export async function validatePath(requestedPath: string, allowedDirectories: string[]): Promise<string> {
    const expandedPath = expandHome(requestedPath)
    const absolute = path.isAbsolute(expandedPath)
        ? path.resolve(expandedPath)
        : resolveRelativePathAgainstAllowedDirectories(expandedPath, allowedDirectories)

    const normalizedRequested = normalizePath(absolute)

    if (!isPathWithinAllowedDirectories(normalizedRequested, allowedDirectories)) {
        throw new Error(
            `Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`,
        )
    }

    try {
        const realPath = await fs.realpath(absolute)
        const normalizedReal = normalizePath(realPath)

        if (!isPathWithinAllowedDirectories(normalizedReal, allowedDirectories)) {
            throw new Error(
                `Access denied - symlink target outside allowed directories: ${realPath} not in ${allowedDirectories.join(', ')}`,
            )
        }

        return realPath
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            const parentDir = path.dirname(absolute)
            try {
                const realParentPath = await fs.realpath(parentDir)
                const normalizedParent = normalizePath(realParentPath)

                if (!isPathWithinAllowedDirectories(normalizedParent, allowedDirectories)) {
                    throw new Error(
                        `Access denied - parent directory outside allowed directories: ${realParentPath} not in ${allowedDirectories.join(', ')}`,
                    )
                }

                return absolute
            } catch {
                throw new Error(`Parent directory does not exist: ${parentDir}`)
            }
        }

        throw error
    }
}

export async function getFileStats(filePath: string): Promise<FileInfo> {
    const stats = await fs.stat(filePath)
    return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        permissions: stats.mode.toString(8).slice(-3),
    }
}

export async function readFileContent(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const stats = await fs.stat(filePath)
    if (stats.isFile() && stats.size > MAX_FILE_READ_BYTES) {
        throw new Error(
            `File too large to read (${formatSize(stats.size)} > ${formatSize(MAX_FILE_READ_BYTES)}). ` +
                `Use the head/tail options of read_text_file instead.`,
        )
    }
    return await fs.readFile(filePath, encoding)
}

export async function writeFileContent(filePath: string, content: string): Promise<void> {
    try {
        await fs.writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' })
        return
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error
        }
    }

    const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`
    try {
        await fs.writeFile(tempPath, content, 'utf-8')
        await fs.rename(tempPath, filePath)
    } catch (renameError) {
        try {
            await fs.unlink(tempPath)
        } catch {
            // Ignore cleanup failures.
        }
        throw renameError
    }
}

export async function applyFileEdits(filePath: string, edits: FileEdit[], dryRun = false): Promise<string> {
    const content = normalizeLineEndings(await readFileContent(filePath, 'utf-8'))

    let modifiedContent = content
    for (const edit of edits) {
        const normalizedOld = normalizeLineEndings(edit.oldText)
        const normalizedNew = normalizeLineEndings(edit.newText)

        if (modifiedContent.includes(normalizedOld)) {
            modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew)
            continue
        }

        const oldLines = normalizedOld.split('\n')
        const contentLines = modifiedContent.split('\n')
        let matchFound = false

        for (let index = 0; index <= contentLines.length - oldLines.length; index += 1) {
            const potentialMatch = contentLines.slice(index, index + oldLines.length)
            const isMatch = oldLines.every((oldLine, lineIndex) => {
                const contentLine = potentialMatch[lineIndex] ?? ''
                return oldLine.trim() === contentLine.trim()
            })

            if (!isMatch) {
                continue
            }

            const originalIndent = contentLines[index]?.match(/^\s*/)?.[0] ?? ''
            const newLines = normalizedNew.split('\n').map((line, lineIndex) => {
                if (lineIndex === 0) {
                    return originalIndent + line.trimStart()
                }

                const oldIndent = oldLines[lineIndex]?.match(/^\s*/)?.[0] ?? ''
                const newIndent = line.match(/^\s*/)?.[0] ?? ''
                if (oldIndent && newIndent) {
                    const relativeIndent = newIndent.length - oldIndent.length
                    return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart()
                }

                return line
            })

            contentLines.splice(index, oldLines.length, ...newLines)
            modifiedContent = contentLines.join('\n')
            matchFound = true
            break
        }

        if (!matchFound) {
            throw new Error(`Could not find exact match for edit:\n${edit.oldText}`)
        }
    }

    const diff = createUnifiedDiff(content, modifiedContent, filePath)

    let numBackticks = 3
    while (diff.includes('`'.repeat(numBackticks))) {
        numBackticks += 1
    }
    const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`

    if (!dryRun) {
        const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`
        try {
            await fs.writeFile(tempPath, modifiedContent, 'utf-8')
            await fs.rename(tempPath, filePath)
        } catch (error) {
            try {
                await fs.unlink(tempPath)
            } catch {
                // Ignore cleanup failures.
            }
            throw error
        }
    }

    return formattedDiff
}

export async function tailFile(filePath: string, numLines: number): Promise<string> {
    const CHUNK_SIZE = 1024
    const stats = await fs.stat(filePath)
    const fileSize = stats.size

    if (fileSize === 0) return ''

    const fileHandle = await fs.open(filePath, 'r')
    try {
        const lines: string[] = []
        let position = fileSize
        const chunk = Buffer.alloc(CHUNK_SIZE)
        let linesFound = 0
        let remainingText = ''

        while (position > 0 && linesFound < numLines) {
            const size = Math.min(CHUNK_SIZE, position)
            position -= size

            const { bytesRead } = await fileHandle.read(chunk, 0, size, position)
            if (!bytesRead) break

            const readData = chunk.slice(0, bytesRead).toString('utf-8')
            const chunkText = readData + remainingText
            const chunkLines = normalizeLineEndings(chunkText).split('\n')

            if (position > 0) {
                remainingText = chunkLines[0] ?? ''
                chunkLines.shift()
            }

            for (let index = chunkLines.length - 1; index >= 0 && linesFound < numLines; index -= 1) {
                lines.unshift(chunkLines[index] ?? '')
                linesFound += 1
            }
        }

        return lines.join('\n')
    } finally {
        await fileHandle.close()
    }
}

export async function headFile(filePath: string, numLines: number): Promise<string> {
    const fileHandle = await fs.open(filePath, 'r')
    try {
        const lines: string[] = []
        let buffer = ''
        let bytesRead = 0
        const chunk = Buffer.alloc(1024)

        while (lines.length < numLines) {
            const result = await fileHandle.read(chunk, 0, chunk.length, bytesRead)
            if (result.bytesRead === 0) break
            bytesRead += result.bytesRead
            buffer += chunk.slice(0, result.bytesRead).toString('utf-8')

            const lastNewLineIndex = buffer.lastIndexOf('\n')
            if (lastNewLineIndex !== -1) {
                const completeLines = buffer.slice(0, lastNewLineIndex).split('\n')
                buffer = buffer.slice(lastNewLineIndex + 1)
                for (const line of completeLines) {
                    lines.push(line)
                    if (lines.length >= numLines) break
                }
            }
        }

        if (buffer.length > 0 && lines.length < numLines) {
            lines.push(buffer)
        }

        return lines.join('\n')
    } finally {
        await fileHandle.close()
    }
}

export async function searchFilesWithValidation(
    rootPath: string,
    pattern: string,
    allowedDirectories: string[],
    options: SearchOptions = {},
): Promise<string[]> {
    const { excludePatterns = [] } = options
    const results: string[] = []

    async function search(currentPath: string) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true })

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name)

            try {
                await validatePath(fullPath, allowedDirectories)

                const relativePath = path.relative(rootPath, fullPath)
                const shouldExclude = excludePatterns.some((excludePattern) =>
                    minimatch(relativePath, excludePattern, { dot: true }),
                )
                if (shouldExclude) continue

                if (minimatch(relativePath, pattern, { dot: true })) {
                    results.push(fullPath)
                }

                if (entry.isDirectory()) {
                    await search(fullPath)
                }
            } catch {
                continue
            }
        }
    }

    await search(rootPath)
    return results
}
