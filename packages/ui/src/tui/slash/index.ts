import type { SlashCommand } from './types'
import { clearCommand } from './clear'
import { exitCommand } from './exit'
import { historyCommand } from './history'
import { modelsCommand } from './models'

export const SLASH_COMMANDS: SlashCommand[] = [exitCommand, clearCommand, historyCommand, modelsCommand]

export type { SlashCommand, SlashCommandContext } from './types'
