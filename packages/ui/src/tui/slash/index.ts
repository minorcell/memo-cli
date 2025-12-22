import type { SlashCommand } from './types'
import { clearCommand } from './clear'
import { exitCommand } from './exit'
import { historyCommand } from './history'

export const SLASH_COMMANDS: SlashCommand[] = [exitCommand, clearCommand, historyCommand]

export type { SlashCommand, SlashCommandContext } from './types'
