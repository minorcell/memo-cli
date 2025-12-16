import type { McpTool, ToolName } from '@memo/tools/tools/types'
import { bashTool } from '@memo/tools/tools/bash'
import { editTool } from '@memo/tools/tools/edit'
import { webfetchTool } from '@memo/tools/tools/webfetch'
import { globTool } from '@memo/tools/tools/glob'
import { grepTool } from '@memo/tools/tools/grep'
import { saveMemoryTool } from '@memo/tools/tools/save_memory'
import { todoTool } from '@memo/tools/tools/todo'
import { timeTool } from '@memo/tools/tools/time'
import { readTool } from '@memo/tools/tools/read'
import { writeTool } from '@memo/tools/tools/write'

import { runBunTool } from '@memo/tools/tools/run_bun'

/** 对外暴露的工具集合，供 Agent 通过 tool name 查找。 */
export const TOOLKIT: Record<ToolName, McpTool<any>> = {
    bash: bashTool,
    run_bun: runBunTool,
    read: readTool,
    write: writeTool,
    edit: editTool,
    glob: globTool,
    grep: grepTool,
    webfetch: webfetchTool,
    save_memory: saveMemoryTool,
    time: timeTool,
    todo: todoTool,
}

/** 工具数组形式，便于直接注册到 MCP Server 等场景。 */
export const TOOL_LIST: McpTool[] = Object.values(TOOLKIT)

export type { McpTool }
