import type { McpTool, ToolName } from '@memo/tools/tools/types'
import { bashTool } from '@memo/tools/tools/bash'
import { editTool } from '@memo/tools/tools/edit'
import { fetchTool } from '@memo/tools/tools/fetch'
import { globTool } from '@memo/tools/tools/glob'
import { grepTool } from '@memo/tools/tools/grep'
import { readTool } from '@memo/tools/tools/read'
import { writeTool } from '@memo/tools/tools/write'

/** 对外暴露的工具集合，供 Agent 通过 tool name 查找。 */
export const TOOLKIT: Record<ToolName, McpTool<any>> = {
    bash: bashTool,
    read: readTool,
    write: writeTool,
    edit: editTool,
    glob: globTool,
    grep: grepTool,
    fetch: fetchTool,
}

/** 工具数组形式，便于直接注册到 MCP Server 等场景。 */
export const TOOL_LIST: McpTool[] = Object.values(TOOLKIT)

export type { McpTool }
