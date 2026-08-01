import assert from 'node:assert'
import { describe, test } from 'vitest'
import { TOOL_STATUS, type ToolResultView } from '../../shared/types'
import { summarizeToolResult } from './toolResultSummary'

function result(tool: string, observation: string, status: ToolResultView['status'] = TOOL_STATUS.SUCCESS) {
    return { tool, observation, status }
}

describe('summarizeToolResult', () => {
    test('hides successful file contents', () => {
        assert.deepStrictEqual(summarizeToolResult(result('read_text_file', 'full\nfile\ncontents'), '/repo', 80), [])
    })

    test('summarizes directory listings by entry count', () => {
        assert.deepStrictEqual(
            summarizeToolResult(result('list_directory', '[DIR] packages\n\n[FILE] package.json'), '/repo', 80),
            ['2 entries'],
        )
    })

    test('shows a few search matches and an explicit remainder count', () => {
        assert.deepStrictEqual(
            summarizeToolResult(
                result('search_files', '/repo/README.md\n/repo/README.zh.md\n/repo/docs/a.md\n/repo/docs/b.md'),
                '/repo',
                80,
            ),
            ['README.md', 'README.zh.md', '+ 2 more'],
        )
    })

    test('keeps command tails with an explicit omitted-line count', () => {
        assert.deepStrictEqual(
            summarizeToolResult(result('exec_command', 'one\ntwo\nthree\nfour\nfive'), '/repo', 80),
            ['… 3 earlier lines', 'four', 'five'],
        )
    })

    test('always retains an error summary for read tools', () => {
        assert.deepStrictEqual(
            summarizeToolResult(result('read_text_file', 'permission denied', TOOL_STATUS.ERROR), '/repo', 80),
            ['permission denied'],
        )
    })
})
