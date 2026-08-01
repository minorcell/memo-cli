import { describe, expect, test } from 'vitest'
import { fallbackSessionTitleFromPrompt, normalizeSessionTitle, truncateSessionTitle } from '@memo/core/utils/title'

describe('session title helpers', () => {
    test('truncateSessionTitle appends ellipsis when exceeding max', () => {
        const truncated = truncateSessionTitle('x'.repeat(80))
        expect(truncated.endsWith('...')).toBe(true)
        expect(truncated.length).toBe(60)
    })

    test('normalizeSessionTitle strips quotes and whitespace', () => {
        expect(normalizeSessionTitle('  "  Hello\nWorld  "  ')).toBe('Hello World')
        expect(normalizeSessionTitle('   ')).toBe('')
    })

    test('normalizeSessionTitle removes think tags and title prefixes', () => {
        expect(
            normalizeSessionTitle(
                '<think>internal</think> Title: "Build REST API migration plan" <thinking>secret</thinking>',
            ),
        ).toBe('Build REST API migration plan')
    })

    test('fallbackSessionTitleFromPrompt handles empty/cjk/word prompts', () => {
        expect(fallbackSessionTitleFromPrompt('   ')).toBe('New Session')
        expect(fallbackSessionTitleFromPrompt('这是一个非常非常长的中文标题用于测试截断行为')).toBe(
            '这是一个非常非常长的中文标题用于测试截断...',
        )
        expect(fallbackSessionTitleFromPrompt('build a rest api using express and sqlite quickly')).toBe(
            'build a rest api using express and sqlite',
        )
    })
})
