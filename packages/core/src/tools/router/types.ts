/** @file MCP configuration and connection types (tools are standard AI SDK Tool objects). */

/** MCP Server configuration (reuses definition from config.ts) */
export type MCPServerConfig =
    | {
          type?: 'stdio'
          command: string
          args?: string[]
          env?: Record<string, string>
          /** Subprocess stderr behavior (silent in TTY by default). */
          stderr?: 'inherit' | 'pipe' | 'ignore'
      }
    | {
          type?: 'streamable_http'
          url: string
          headers?: Record<string, string>
          http_headers?: Record<string, string>
          bearer_token_env_var?: string
      }

/** MCP Client connection info (AI SDK MCP client + tool set). */
export interface McpClientConnection {
    name: string
    client: import('@ai-sdk/mcp').MCPClient
    /** originalName → AI SDK Tool (own execute, JSON-RPC under the hood). */
    tools: Record<string, import('ai').Tool>
}
