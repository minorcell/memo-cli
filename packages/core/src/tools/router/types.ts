/** @file ToolRouter unified type definitions */

/** Tool source type */
export type ToolSource = 'native' | 'mcp'

/** JSON Schema basic type */
export interface JSONSchema {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
    description?: string
    [key: string]: unknown
}

/** Tool execution output (AI SDK ToolResultOutput-compatible subset). */
export type MemoToolOutput =
    | { type: 'text'; value: string }
    | { type: 'json'; value: unknown }
    | { type: 'error-text'; value: string }
    | { type: 'execution-denied'; reason?: string }

/** Unified tool interface */
export interface Tool {
    /** Unique tool name (MCP tools have serverName_ prefix) */
    name: string
    /** Tool description */
    description: string
    /** Tool source */
    source: ToolSource
    /** JSON Schema for input parameters */
    inputSchema: JSONSchema
    /** Whether parallel calls are supported (default false, conservative serial). */
    supportsParallelToolCalls?: boolean
    /** Whether it modifies external state (files, processes, network writes, etc.). */
    isMutating?: boolean
    /** Optional input validator (usually provided by native/zod adapter layer) */
    validateInput?: (input: unknown) => { ok: true; data: unknown } | { ok: false; error: string }
    /** Execute tool */
    execute: (input: unknown, options?: { abortSignal?: AbortSignal }) => Promise<MemoToolOutput>
}

/** Built-in tool */
export interface NativeTool extends Tool {
    source: 'native'
}

/** MCP external tool */
export interface McpTool extends Tool {
    source: 'mcp'
    /** Source server name */
    serverName: string
    /** Original tool name on server side */
    originalName: string
}

/** Tool registry */
export type ToolRegistry = Record<string, Tool>

/** Tool description (for Prompt generation) */
export interface ToolDescription {
    name: string
    description: string
    source: ToolSource
    serverName?: string
    inputSchema: JSONSchema
}

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
