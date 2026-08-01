import {
    getFileSuggestions as getCoreFileSuggestions,
    invalidateFileSuggestionCache as invalidateCoreFileSuggestionCache,
    normalizePath as normalizeCorePath,
    type FileSuggestion as CoreFileSuggestion,
    type FileSuggestionRequest as CoreFileSuggestionRequest,
} from '@memo/core'
import type { FileSuggestion, FileSuggestionRequest } from '../../shared/types'

export function normalizePath(input: string): string {
    return normalizeCorePath(input)
}

export async function getFileSuggestions(req: FileSuggestionRequest): Promise<FileSuggestion[]> {
    return getCoreFileSuggestions(req as CoreFileSuggestionRequest) as Promise<FileSuggestion[]>
}

export function invalidateFileSuggestionCache(cwd?: string): void {
    invalidateCoreFileSuggestionCache(cwd)
}

export type { CoreFileSuggestion, CoreFileSuggestionRequest }
