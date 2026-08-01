import { describe, expect, test } from 'vitest'
import { filterMcpServersBySelection } from '@memo/core/agent/defaults'

describe('filterMcpServersBySelection', () => {
    const servers = {
        alpha: { command: 'node', args: ['a.js'] },
        beta: { type: 'streamable_http' as const, url: 'https://example.com/mcp' },
    }

    test('returns all servers when no active list is provided', () => {
        expect(filterMcpServersBySelection(servers, undefined)).toEqual(servers)
    })

    test('returns only selected servers', () => {
        expect(filterMcpServersBySelection(servers, ['beta'])).toEqual({
            beta: servers.beta,
        })
    })

    test('returns empty map when active list is empty', () => {
        expect(filterMcpServersBySelection(servers, [])).toEqual({})
    })

    test('ignores unknown server names', () => {
        expect(filterMcpServersBySelection(servers, ['missing', 'alpha'])).toEqual({
            alpha: servers.alpha,
        })
    })
})
