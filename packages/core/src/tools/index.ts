import type { Tool } from 'ai'
import { shellTool } from '@memo/core/tools/tools/shell'
import { shellCommandTool } from '@memo/core/tools/tools/shell_command'
import { execCommandTool } from '@memo/core/tools/tools/exec_command'
import { writeStdinTool } from '@memo/core/tools/tools/write_stdin'
import { applyPatchTool } from '@memo/core/tools/tools/apply_patch'
import { readTextFileTool } from '@memo/core/tools/tools/read_text_file'
import { readMediaFileTool } from '@memo/core/tools/tools/read_media_file'
import { readFilesTool } from '@memo/core/tools/tools/read_files'
import { writeFileTool } from '@memo/core/tools/tools/write_file'
import { editFileTool } from '@memo/core/tools/tools/edit_file'
import { listDirectoryTool } from '@memo/core/tools/tools/list_directory'
import { searchFilesTool } from '@memo/core/tools/tools/search_files'
import {
    listMcpResourceTemplatesTool,
    listMcpResourcesTool,
    readMcpResourceTool,
} from '@memo/core/tools/tools/mcp_resources'
import { updatePlanTool } from '@memo/core/tools/tools/update_plan'
import { getMemoryTool } from '@memo/core/tools/tools/get_memory'
import { readSkillTool } from '@memo/core/tools/tools/read_skill'
import { webfetchTool } from '@memo/core/tools/tools/webfetch'
import {
    followupTaskTool,
    interruptAgentTool,
    listAgentsTool,
    sendMessageTool,
    spawnAgentTool,
    waitAgentTool,
} from '@memo/core/tools/tools/collab'

function buildCodexTools(): Record<string, Tool> {
    const tools: Record<string, Tool> = {}
    const shellMode = process.env.MEMO_SHELL_TOOL_TYPE?.trim() || 'unified_exec'
    const collabEnabled = process.env.MEMO_ENABLE_COLLAB_TOOLS !== '0'
    const memoryToolEnabled = process.env.MEMO_ENABLE_MEMORY_TOOL !== '0'

    if (shellMode === 'shell') {
        tools.shell = shellTool
    } else if (shellMode === 'shell_command') {
        tools.shell_command = shellCommandTool
    } else if (shellMode === 'unified_exec') {
        tools.exec_command = execCommandTool
        tools.write_stdin = writeStdinTool
    } else if (shellMode !== 'disabled') {
        tools.exec_command = execCommandTool
        tools.write_stdin = writeStdinTool
    }

    tools.list_mcp_resources = listMcpResourcesTool
    tools.list_mcp_resource_templates = listMcpResourceTemplatesTool
    tools.read_mcp_resource = readMcpResourceTool
    tools.update_plan = updatePlanTool
    tools.read_skill = readSkillTool
    tools.apply_patch = applyPatchTool
    tools.read_text_file = readTextFileTool
    tools.read_media_file = readMediaFileTool
    tools.read_files = readFilesTool
    tools.write_file = writeFileTool
    tools.edit_file = editFileTool
    tools.list_directory = listDirectoryTool
    tools.search_files = searchFilesTool

    if (memoryToolEnabled) {
        tools.get_memory = getMemoryTool
    }

    tools.webfetch = webfetchTool

    if (collabEnabled) {
        tools.spawn_agent = spawnAgentTool
        tools.send_message = sendMessageTool
        tools.followup_task = followupTaskTool
        tools.wait_agent = waitAgentTool
        tools.interrupt_agent = interruptAgentTool
        tools.list_agents = listAgentsTool
    }

    return tools
}

/** Exposed built-in tool collection (AI SDK ToolSet, keys are tool names). */
export const TOOLKIT: Record<string, Tool> = buildCodexTools()

/** Tool array form, convenient for direct registration. */
export const TOOL_LIST: Tool[] = Object.values(TOOLKIT)

/** Built-in tools (already AI SDK Tool format, no adaptation needed). */
export const NATIVE_TOOLS = TOOLKIT

export * from '@memo/core/tools/approval'
export * from '@memo/core/tools/router'
