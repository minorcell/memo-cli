import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { getRuntimeCwd } from '@memo/core/tools/runtime/context'
import { textResult } from '@memo/core/tools/tools/mcp'
import { normalizePath, writePathDenyReason } from '@memo/core/tools/tools/helpers'
import { defineMcpTool } from '@memo/core/tools/tools/types'

const BEGIN_PATCH_MARKER = '*** Begin Patch'
const END_PATCH_MARKER = '*** End Patch'
const ADD_FILE_MARKER = '*** Add File: '
const DELETE_FILE_MARKER = '*** Delete File: '
const UPDATE_FILE_MARKER = '*** Update File: '
const MOVE_TO_MARKER = '*** Move to: '
const EOF_MARKER = '*** End of File'
const CHANGE_CONTEXT_MARKER = '@@ '
const EMPTY_CHANGE_CONTEXT_MARKER = '@@'

const APPLY_PATCH_INPUT_SCHEMA = z
    .object({
        input: z.string().min(1, 'input cannot be empty'),
    })
    .strict()

const APPLY_PATCH_DESCRIPTION = `Use the \`apply_patch\` tool to edit files.
Your patch language is a stripped‑down, file‑oriented diff format designed to be easy to parse and safe to apply. You can think of it as a high‑level envelope:

*** Begin Patch
[ one or more file sections ]
*** End Patch

Within that envelope, you get a sequence of file operations.
You MUST include a header to specify the action you are taking.
Each operation starts with one of three headers:

*** Add File: <path> - create a new file. Every following line is a + line (the initial contents).
*** Delete File: <path> - remove an existing file. Nothing follows.
*** Update File: <path> - patch an existing file in place (optionally with a rename).

May be immediately followed by *** Move to: <new path> if you want to rename the file.
Then one or more “hunks”, each introduced by @@ (optionally followed by a hunk header).
Within a hunk each line starts with:

For instructions on [context_before] and [context_after]:
- By default, show 3 lines of code immediately above and 3 lines immediately below each change. If a change is within 3 lines of a previous change, do NOT duplicate the first change’s [context_after] lines in the second change’s [context_before] lines.
- If 3 lines of context is insufficient to uniquely identify the snippet of code within the file, use the @@ operator to indicate the class or function to which the snippet belongs. For instance, we might have:
@@ class BaseClass
[3 lines of pre-context]
- [old_code]
+ [new_code]
[3 lines of post-context]

- If a code block is repeated so many times in a class or function such that even a single @@ statement and 3 lines of context cannot uniquely identify the snippet of code, you can use multiple @@ statements to jump to the right context. For instance:

@@ class BaseClass
@@ 	 def method():
[3 lines of pre-context]
- [old_code]
+ [new_code]
[3 lines of post-context]

The full grammar definition is below:
Patch := Begin { FileOp } End
Begin := "*** Begin Patch" NEWLINE
End := "*** End Patch" NEWLINE
FileOp := AddFile | DeleteFile | UpdateFile
AddFile := "*** Add File: " path NEWLINE { "+" line NEWLINE }
DeleteFile := "*** Delete File: " path NEWLINE
UpdateFile := "*** Update File: " path NEWLINE [ MoveTo ] { Hunk }
MoveTo := "*** Move to: " newPath NEWLINE
Hunk := "@@" [ header ] NEWLINE { HunkLine } [ "*** End of File" NEWLINE ]
HunkLine := (" " | "-" | "+") text NEWLINE

A full patch can combine several operations:

*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch

It is important to remember:

- You must include a header with your intended action (Add/Delete/Update)
- You must prefix new lines with \`+\` even when creating a new file
- File references can only be relative, NEVER ABSOLUTE.
`

type ApplyPatchInput = z.infer<typeof APPLY_PATCH_INPUT_SCHEMA>

type AddFileHunk = {
    type: 'add'
    path: string
    contents: string
}

type DeleteFileHunk = {
    type: 'delete'
    path: string
}

type UpdateFileChunk = {
    changeContext: string | null
    oldLines: string[]
    newLines: string[]
    isEndOfFile: boolean
}

type UpdateFileHunk = {
    type: 'update'
    path: string
    movePath: string | null
    chunks: UpdateFileChunk[]
}

type Hunk = AddFileHunk | DeleteFileHunk | UpdateFileHunk

type Replacement = {
    startIndex: number
    oldLength: number
    newLines: string[]
}

type PlannedChange =
    | {
          type: 'add'
          targetPath: string
          displayPath: string
          content: string
      }
    | {
          type: 'delete'
          targetPath: string
          displayPath: string
      }
    | {
          type: 'update'
          sourcePath: string
          targetPath: string
          displayPath: string
          newContent: string
      }

class ApplyPatchParseError extends Error {
    lineNumber: number | null

    constructor(message: string, lineNumber?: number) {
        super(message)
        this.lineNumber = typeof lineNumber === 'number' ? lineNumber : null
    }
}

function invalidPatch(message: string): never {
    throw new ApplyPatchParseError(message)
}

function invalidHunk(message: string, lineNumber: number): never {
    throw new ApplyPatchParseError(message, lineNumber)
}

function parsePathFromHeader(path: string, lineNumber: number): string {
    const value = path.trim()
    if (!value) {
        invalidHunk('path cannot be empty', lineNumber)
    }
    if (isAbsolute(value)) {
        invalidHunk(`File references must be relative, NEVER ABSOLUTE: ${value}`, lineNumber)
    }
    return value
}

function checkPatchBoundariesStrict(lines: string[]) {
    const first = lines[0]?.trim()
    const last = lines[lines.length - 1]?.trim()

    if (first !== BEGIN_PATCH_MARKER) {
        invalidPatch(`The first line of the patch must be '${BEGIN_PATCH_MARKER}'`)
    }
    if (last !== END_PATCH_MARKER) {
        invalidPatch(`The last line of the patch must be '${END_PATCH_MARKER}'`)
    }
}

function checkPatchBoundariesLenient(originalLines: string[], originalParseError: ApplyPatchParseError): string[] {
    if (originalLines.length < 4) {
        throw originalParseError
    }
    const first = originalLines[0]
    const last = originalLines[originalLines.length - 1]
    if ((first === '<<EOF' || first === "<<'EOF'" || first === '<<"EOF"') && last.endsWith('EOF')) {
        const inner = originalLines.slice(1, -1)
        checkPatchBoundariesStrict(inner)
        return inner
    }
    throw originalParseError
}

function parsePatch(input: string): Hunk[] {
    const originalLines = input.trim().split(/\r?\n/)
    if (originalLines.length === 0 || !originalLines[0]) {
        invalidPatch(`The first line of the patch must be '${BEGIN_PATCH_MARKER}'`)
    }

    let lines = originalLines
    try {
        checkPatchBoundariesStrict(lines)
    } catch (err) {
        if (!(err instanceof ApplyPatchParseError) || err.lineNumber !== null) {
            throw err
        }
        lines = checkPatchBoundariesLenient(originalLines, err)
    }

    const hunks: Hunk[] = []
    let remaining = lines.slice(1, Math.max(lines.length - 1, 1))
    let lineNumber = 2

    while (remaining.length > 0) {
        const parsed = parseOneHunk(remaining, lineNumber)
        hunks.push(parsed.hunk)
        lineNumber += parsed.parsedLines
        remaining = remaining.slice(parsed.parsedLines)
    }

    return hunks
}

function parseOneHunk(
    lines: string[],
    lineNumber: number,
): {
    hunk: Hunk
    parsedLines: number
} {
    const firstLine = lines[0].trim()
    if (firstLine.startsWith(ADD_FILE_MARKER)) {
        const path = parsePathFromHeader(firstLine.slice(ADD_FILE_MARKER.length), lineNumber)
        let contents = ''
        let parsedLines = 1
        for (let i = 1; i < lines.length; i += 1) {
            const addLine = lines[i]
            if (addLine.startsWith('+')) {
                contents += `${addLine.slice(1)}\n`
                parsedLines += 1
                continue
            }
            break
        }
        return {
            hunk: {
                type: 'add',
                path,
                contents,
            },
            parsedLines,
        }
    }

    if (firstLine.startsWith(DELETE_FILE_MARKER)) {
        const path = parsePathFromHeader(firstLine.slice(DELETE_FILE_MARKER.length), lineNumber)
        return {
            hunk: {
                type: 'delete',
                path,
            },
            parsedLines: 1,
        }
    }

    if (firstLine.startsWith(UPDATE_FILE_MARKER)) {
        const path = parsePathFromHeader(firstLine.slice(UPDATE_FILE_MARKER.length), lineNumber)
        let remaining = lines.slice(1)
        let parsedLines = 1

        let movePath: string | null = null
        const maybeMove = remaining[0]?.startsWith(MOVE_TO_MARKER) ? remaining[0].slice(MOVE_TO_MARKER.length) : null
        if (typeof maybeMove === 'string') {
            movePath = parsePathFromHeader(maybeMove, lineNumber + 1)
            remaining = remaining.slice(1)
            parsedLines += 1
        }

        const chunks: UpdateFileChunk[] = []
        while (remaining.length > 0) {
            if (remaining[0].trim().length === 0) {
                remaining = remaining.slice(1)
                parsedLines += 1
                continue
            }

            if (remaining[0].startsWith('***')) {
                break
            }

            const parsedChunk = parseUpdateFileChunk(remaining, lineNumber + parsedLines, chunks.length === 0)
            chunks.push(parsedChunk.chunk)
            remaining = remaining.slice(parsedChunk.parsedLines)
            parsedLines += parsedChunk.parsedLines
        }

        if (chunks.length === 0) {
            invalidHunk(`Update file hunk for path '${path}' is empty`, lineNumber)
        }

        return {
            hunk: {
                type: 'update',
                path,
                movePath,
                chunks,
            },
            parsedLines,
        }
    }

    invalidHunk(
        `'${firstLine}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
        lineNumber,
    )
}

function parseUpdateFileChunk(
    lines: string[],
    lineNumber: number,
    allowMissingContext: boolean,
): {
    chunk: UpdateFileChunk
    parsedLines: number
} {
    if (lines.length === 0) {
        invalidHunk('Update hunk does not contain any lines', lineNumber)
    }

    let changeContext: string | null = null
    let startIndex = 0
    if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
        startIndex = 1
    } else if (lines[0].startsWith(CHANGE_CONTEXT_MARKER)) {
        changeContext = lines[0].slice(CHANGE_CONTEXT_MARKER.length)
        startIndex = 1
    } else if (!allowMissingContext) {
        invalidHunk(`Expected update hunk to start with a @@ context marker, got: '${lines[0]}'`, lineNumber)
    }

    if (startIndex >= lines.length) {
        invalidHunk('Update hunk does not contain any lines', lineNumber + 1)
    }

    const chunk: UpdateFileChunk = {
        changeContext,
        oldLines: [],
        newLines: [],
        isEndOfFile: false,
    }

    let parsedLines = 0
    for (let i = startIndex; i < lines.length; i += 1) {
        const line = lines[i]
        if (line === EOF_MARKER) {
            if (parsedLines === 0) {
                invalidHunk('Update hunk does not contain any lines', lineNumber + 1)
            }
            chunk.isEndOfFile = true
            parsedLines += 1
            break
        }

        const prefix = line[0]
        if (line.length === 0) {
            chunk.oldLines.push('')
            chunk.newLines.push('')
            parsedLines += 1
            continue
        }
        if (prefix === ' ') {
            const value = line.slice(1)
            chunk.oldLines.push(value)
            chunk.newLines.push(value)
            parsedLines += 1
            continue
        }
        if (prefix === '+') {
            chunk.newLines.push(line.slice(1))
            parsedLines += 1
            continue
        }
        if (prefix === '-') {
            chunk.oldLines.push(line.slice(1))
            parsedLines += 1
            continue
        }
        if (parsedLines === 0) {
            invalidHunk(
                `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
                lineNumber + 1,
            )
        }
        break
    }

    return {
        chunk,
        parsedLines: parsedLines + startIndex,
    }
}

function normalizeUnicodeForMatch(text: string): string {
    return text
        .trim()
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000]/g, ' ')
}

function seekSequence(lines: string[], pattern: string[], start: number, eof: boolean): number | null {
    if (pattern.length === 0) {
        return start
    }
    if (pattern.length > lines.length) {
        return null
    }

    const searchStart = eof && lines.length >= pattern.length ? lines.length - pattern.length : start
    const max = lines.length - pattern.length

    for (let i = searchStart; i <= max; i += 1) {
        let matched = true
        for (let j = 0; j < pattern.length; j += 1) {
            if (lines[i + j] !== pattern[j]) {
                matched = false
                break
            }
        }
        if (matched) return i
    }

    for (let i = searchStart; i <= max; i += 1) {
        let matched = true
        for (let j = 0; j < pattern.length; j += 1) {
            if (lines[i + j].trimEnd() !== pattern[j].trimEnd()) {
                matched = false
                break
            }
        }
        if (matched) return i
    }

    for (let i = searchStart; i <= max; i += 1) {
        let matched = true
        for (let j = 0; j < pattern.length; j += 1) {
            if (lines[i + j].trim() !== pattern[j].trim()) {
                matched = false
                break
            }
        }
        if (matched) return i
    }

    for (let i = searchStart; i <= max; i += 1) {
        let matched = true
        for (let j = 0; j < pattern.length; j += 1) {
            if (normalizeUnicodeForMatch(lines[i + j]) !== normalizeUnicodeForMatch(pattern[j])) {
                matched = false
                break
            }
        }
        if (matched) return i
    }

    return null
}

function computeReplacements(originalLines: string[], displayPath: string, chunks: UpdateFileChunk[]): Replacement[] {
    const replacements: Replacement[] = []
    let lineIndex = 0

    for (const chunk of chunks) {
        if (typeof chunk.changeContext === 'string') {
            const contextIndex = seekSequence(originalLines, [chunk.changeContext], lineIndex, false)
            if (contextIndex === null) {
                throw new Error(`Failed to find context '${chunk.changeContext}' in ${displayPath}`)
            }
            lineIndex = contextIndex + 1
        }

        if (chunk.oldLines.length === 0) {
            const insertionIndex =
                originalLines.length > 0 && originalLines[originalLines.length - 1] === ''
                    ? originalLines.length - 1
                    : originalLines.length
            replacements.push({
                startIndex: insertionIndex,
                oldLength: 0,
                newLines: [...chunk.newLines],
            })
            continue
        }

        let pattern = [...chunk.oldLines]
        let newSlice = [...chunk.newLines]
        let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile)

        if (found === null && pattern.length > 0 && pattern[pattern.length - 1] === '') {
            pattern = pattern.slice(0, -1)
            if (newSlice.length > 0 && newSlice[newSlice.length - 1] === '') {
                newSlice = newSlice.slice(0, -1)
            }
            found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile)
        }

        if (found === null) {
            throw new Error(`Failed to find expected lines in ${displayPath}:\n${chunk.oldLines.join('\n')}`)
        }

        replacements.push({
            startIndex: found,
            oldLength: pattern.length,
            newLines: newSlice,
        })
        lineIndex = found + pattern.length
    }

    replacements.sort((lhs, rhs) => lhs.startIndex - rhs.startIndex)
    return replacements
}

function applyReplacements(lines: string[], replacements: Replacement[]): string[] {
    const output = [...lines]
    for (let i = replacements.length - 1; i >= 0; i -= 1) {
        const replacement = replacements[i]
        output.splice(replacement.startIndex, replacement.oldLength, ...replacement.newLines)
    }
    return output
}

function deriveNewContentsFromChunks(originalContents: string, displayPath: string, chunks: UpdateFileChunk[]): string {
    const originalLines = originalContents.split('\n')
    if (originalLines.length > 0 && originalLines[originalLines.length - 1] === '') {
        originalLines.pop()
    }

    const replacements = computeReplacements(originalLines, displayPath, chunks)
    const newLines = applyReplacements(originalLines, replacements)
    if (newLines.length === 0 || newLines[newLines.length - 1] !== '') {
        newLines.push('')
    }
    return newLines.join('\n')
}

function resolvePatchPath(cwd: string, patchPath: string): string {
    return normalizePath(join(cwd, patchPath))
}

async function canonicalWritePath(absPath: string): Promise<string> {
    const normalized = normalizePath(absPath)
    try {
        return normalizePath(await realpath(normalized))
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
            throw err
        }

        const suffixParts: string[] = [basename(normalized)]
        let parent = dirname(normalized)
        while (true) {
            try {
                const parentRealPath = normalizePath(await realpath(parent))
                return normalizePath(join(parentRealPath, ...suffixParts))
            } catch (innerErr) {
                const innerCode = (innerErr as NodeJS.ErrnoException).code
                const nextParent = dirname(parent)
                if (innerCode !== 'ENOENT' || nextParent === parent) {
                    return normalized
                }
                suffixParts.unshift(basename(parent))
                parent = nextParent
            }
        }
    }
}

async function ensureWritable(absPath: string): Promise<string> {
    const targetPath = await canonicalWritePath(absPath)
    const reason = writePathDenyReason(targetPath)
    if (reason) {
        throw new Error(reason)
    }
    return targetPath
}

async function planChanges(hunks: Hunk[], cwd: string): Promise<PlannedChange[]> {
    const changes: PlannedChange[] = []
    for (const hunk of hunks) {
        if (hunk.type === 'add') {
            const targetPath = await ensureWritable(resolvePatchPath(cwd, hunk.path))
            changes.push({
                type: 'add',
                targetPath,
                displayPath: hunk.path,
                content: hunk.contents,
            })
            continue
        }

        if (hunk.type === 'delete') {
            const targetPath = await ensureWritable(resolvePatchPath(cwd, hunk.path))
            try {
                await readFile(targetPath, 'utf8')
            } catch (err) {
                throw new Error(`Failed to read ${hunk.path}: ${(err as Error).message}`)
            }
            changes.push({
                type: 'delete',
                targetPath,
                displayPath: hunk.path,
            })
            continue
        }

        const sourcePath = await ensureWritable(resolvePatchPath(cwd, hunk.path))
        let originalContents: string
        try {
            originalContents = await readFile(sourcePath, 'utf8')
        } catch (err) {
            throw new Error(`Failed to read file to update ${hunk.path}: ${(err as Error).message}`)
        }

        const newContent = deriveNewContentsFromChunks(originalContents, hunk.path, hunk.chunks)
        const targetPath = hunk.movePath ? await ensureWritable(resolvePatchPath(cwd, hunk.movePath)) : sourcePath

        changes.push({
            type: 'update',
            sourcePath,
            targetPath,
            displayPath: hunk.movePath ?? hunk.path,
            newContent,
        })
    }
    return changes
}

async function applyChanges(changes: PlannedChange[]) {
    if (changes.length === 0) {
        throw new Error('No files were modified.')
    }

    const added: string[] = []
    const modified: string[] = []
    const deleted: string[] = []

    for (const change of changes) {
        if (change.type === 'add') {
            const parent = dirname(change.targetPath)
            if (parent) {
                await mkdir(parent, { recursive: true })
            }
            await writeFile(change.targetPath, change.content, 'utf8')
            added.push(change.displayPath)
            continue
        }

        if (change.type === 'delete') {
            await rm(change.targetPath)
            deleted.push(change.displayPath)
            continue
        }

        const parent = dirname(change.targetPath)
        if (parent) {
            await mkdir(parent, { recursive: true })
        }
        await writeFile(change.targetPath, change.newContent, 'utf8')
        if (change.targetPath !== change.sourcePath) {
            await rm(change.sourcePath)
        }
        modified.push(change.displayPath)
    }

    const lines = ['Success. Updated the following files:']
    for (const path of added) {
        lines.push(`A ${path}`)
    }
    for (const path of modified) {
        lines.push(`M ${path}`)
    }
    for (const path of deleted) {
        lines.push(`D ${path}`)
    }

    return lines.join('\n')
}

function formatParseError(err: ApplyPatchParseError): string {
    if (typeof err.lineNumber === 'number') {
        return `Invalid patch hunk on line ${err.lineNumber}: ${err.message}`
    }
    return `Invalid patch: ${err.message}`
}

export const applyPatchTool = defineMcpTool<ApplyPatchInput>({
    name: 'apply_patch',
    description: APPLY_PATCH_DESCRIPTION,
    inputSchema: APPLY_PATCH_INPUT_SCHEMA,
    supportsParallelToolCalls: false,
    isMutating: true,
    execute: async (input) => {
        const parsed = APPLY_PATCH_INPUT_SCHEMA.safeParse(input)
        if (!parsed.success) {
            const detail = parsed.error.issues[0]?.message ?? 'invalid input'
            return textResult(`apply_patch invalid input: ${detail}`, true)
        }

        try {
            const hunks = parsePatch(parsed.data.input)
            const cwd = getRuntimeCwd()
            const changes = await planChanges(hunks, cwd)
            const summary = await applyChanges(changes)
            return textResult(summary)
        } catch (err) {
            if (err instanceof ApplyPatchParseError) {
                return textResult(formatParseError(err), true)
            }
            return textResult((err as Error).message, true)
        }
    },
})
