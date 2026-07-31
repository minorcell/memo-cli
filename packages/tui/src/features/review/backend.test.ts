import assert from 'node:assert'
import { describe, test } from 'vitest'
import type { MCPServerConfig } from '@memo/core'
import { detectGitHubMcpToolPrefixes, findActiveGitHubMcpServer, isGitHubMcpServer } from './backend'

describe('github review backend detection', () => {
    test('detects github server by name', () => {
        const config: MCPServerConfig = {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
        }
        assert.strictEqual(isGitHubMcpServer('github', config), true)
    })

    test('detects github server by stdio command/args', () => {
        const config: MCPServerConfig = {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
        }
        assert.strictEqual(isGitHubMcpServer('tools', config), true)
    })

    test('detects github server by streamable URL', () => {
        const config: MCPServerConfig = {
            type: 'streamable_http',
            url: 'https://api.github.com/mcp',
        }
        assert.strictEqual(isGitHubMcpServer('remote', config), true)
    })

    test('finds active github candidate and inactive candidates', () => {
        const mcpServers: Record<string, MCPServerConfig> = {
            github: {
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-github'],
            },
            gh_tools: {
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-github'],
            },
            docs: {
                type: 'streamable_http',
                url: 'https://docs.example.com/mcp',
            },
        }

        const result = findActiveGitHubMcpServer(mcpServers, ['gh_tools'])
        assert.strictEqual(result.active, 'gh_tools')
        assert.deepStrictEqual(result.inactiveCandidates, ['github'])
    })

    test('detects github mcp server prefix from loaded tool signatures', () => {
        const toolNames = [
            'team_pull_request_read',
            'team_add_issue_comment',
            'team_search_pull_requests',
            'docs_list_resources',
        ]
        assert.deepStrictEqual(detectGitHubMcpToolPrefixes(toolNames), ['team'])
    })
})
