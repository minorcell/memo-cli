/** @file Agent loop constants shared across agent modules. */
import type { SessionMode } from '@memo/core/types'
import type { ToolActionStatus } from '@memo/core/tools/approval'

export const DEFAULT_SESSION_MODE: SessionMode = 'interactive'
export const DEFAULT_CONTEXT_WINDOW = 120_000
export const TOOL_ACTION_SUCCESS_STATUS: ToolActionStatus = 'success'
export const TOOL_DISABLED_ERROR_MESSAGE =
    'Tool usage is disabled in the current permission mode. Switch to /core/tools once or /core/tools full to enable tools.'
