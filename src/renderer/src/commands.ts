export type AppCommandId =
  | 'terminal.find'
  | 'palette.open'
  | 'terminal.new-tab'
  | 'terminal.close'
  | 'pane.split-right'
  | 'pane.split-down'
  | 'pane.close'
  | 'workspace.new'
  | 'workspace.close'
  | 'workspace.previous'
  | 'workspace.next'
  | 'sidebar.toggle'
  | 'notification.jump-unread'
  | 'notification.mark-read'
  | 'font.increase'
  | 'font.decrease'
  | 'font.reset'
  | 'help.open'

export type CommandCategory = 'Terminal' | 'Pane' | 'Workspace' | 'Attention' | 'View'

export interface CommandContext {
  workspaceCount: number
  paneCount: number
  terminalCount: number
  unreadNotificationCount: number
  sidebarCollapsed: boolean
}

export interface AppCommand {
  id: AppCommandId
  title: string
  category: CommandCategory
  shortcut?: string
  shortcutKey?: string
  keywords: string
  availability?:
    'several-workspaces' | 'several-panes' | 'closable-terminal' | 'unread-notifications'
}

export const APP_COMMANDS: readonly AppCommand[] = [
  {
    id: 'terminal.find',
    title: 'Find in current terminal',
    category: 'Terminal',
    shortcut: 'Ctrl+Shift+F',
    shortcutKey: 'f',
    keywords: 'search scrollback output'
  },
  {
    id: 'palette.open',
    title: 'Open command palette',
    category: 'View',
    shortcut: 'Ctrl+Shift+P',
    shortcutKey: 'p',
    keywords: 'commands actions'
  },
  {
    id: 'terminal.new-tab',
    title: 'New terminal tab',
    category: 'Terminal',
    shortcut: 'Ctrl+Shift+T',
    shortcutKey: 't',
    keywords: 'surface create'
  },
  {
    id: 'terminal.close',
    title: 'Close current terminal',
    category: 'Terminal',
    shortcut: 'Ctrl+Shift+W',
    shortcutKey: 'w',
    keywords: 'surface tab remove',
    availability: 'closable-terminal'
  },
  {
    id: 'pane.close',
    title: 'Close current pane',
    category: 'Pane',
    keywords: 'remove terminal split',
    availability: 'several-panes'
  },
  {
    id: 'pane.split-right',
    title: 'Split pane right',
    category: 'Pane',
    shortcut: 'Ctrl+Shift+D',
    shortcutKey: 'd',
    keywords: 'horizontal row terminal'
  },
  {
    id: 'pane.split-down',
    title: 'Split pane down',
    category: 'Pane',
    shortcut: 'Ctrl+Shift+E',
    shortcutKey: 'e',
    keywords: 'vertical column terminal'
  },
  {
    id: 'workspace.new',
    title: 'New workspace',
    category: 'Workspace',
    shortcut: 'Ctrl+Shift+N',
    shortcutKey: 'n',
    keywords: 'project create'
  },
  {
    id: 'workspace.close',
    title: 'Close current workspace',
    category: 'Workspace',
    keywords: 'project remove',
    availability: 'several-workspaces'
  },
  {
    id: 'workspace.previous',
    title: 'Select previous workspace',
    category: 'Workspace',
    keywords: 'navigate back'
  },
  {
    id: 'workspace.next',
    title: 'Select next workspace',
    category: 'Workspace',
    keywords: 'navigate forward'
  },
  {
    id: 'sidebar.toggle',
    title: 'Toggle sidebar',
    category: 'View',
    shortcut: 'Ctrl+Shift+B',
    shortcutKey: 'b',
    keywords: 'show hide collapse'
  },
  {
    id: 'notification.jump-unread',
    title: 'Jump to latest unread',
    category: 'Attention',
    shortcut: 'Ctrl+Shift+U',
    shortcutKey: 'u',
    keywords: 'notification inbox pending',
    availability: 'unread-notifications'
  },
  {
    id: 'notification.mark-read',
    title: 'Mark current workspace read',
    category: 'Attention',
    shortcut: 'Ctrl+Shift+M',
    shortcutKey: 'm',
    keywords: 'notification acknowledge'
  },
  {
    id: 'font.increase',
    title: 'Increase terminal font',
    category: 'View',
    shortcut: 'Ctrl+Shift++',
    shortcutKey: '+',
    keywords: 'zoom text larger'
  },
  {
    id: 'font.decrease',
    title: 'Decrease terminal font',
    category: 'View',
    shortcut: 'Ctrl+Shift+-',
    shortcutKey: '-',
    keywords: 'zoom text smaller'
  },
  {
    id: 'font.reset',
    title: 'Reset terminal font',
    category: 'View',
    shortcut: 'Ctrl+Shift+0',
    shortcutKey: '0',
    keywords: 'zoom default reset'
  },
  {
    id: 'help.open',
    title: 'Show contextual shortcuts',
    category: 'View',
    shortcut: 'Ctrl+Shift+?',
    shortcutKey: '?',
    keywords: 'help keyboard reference'
  }
]

const COMMAND_BY_ID = new Map(APP_COMMANDS.map((command) => [command.id, command]))
const COMMAND_BY_KEY = new Map(
  APP_COMMANDS.flatMap((command) =>
    command.shortcutKey ? [[command.shortcutKey, command.id] as const] : []
  )
)

export function commandEnabled(id: AppCommandId, context: CommandContext): boolean {
  const requirement = COMMAND_BY_ID.get(id)?.availability
  if (requirement === 'several-workspaces') return context.workspaceCount > 1
  if (requirement === 'several-panes') return context.paneCount > 1
  if (requirement === 'closable-terminal') return context.terminalCount > 1
  if (requirement === 'unread-notifications') return context.unreadNotificationCount > 0
  return COMMAND_BY_ID.has(id)
}

function normalizedWords(value: string): string[] {
  return value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 8)
}

function commandScore(command: AppCommand, words: readonly string[]): number | null {
  if (words.length === 0) return 0
  const title = command.title.toLocaleLowerCase()
  const category = command.category.toLocaleLowerCase()
  const haystack = `${title} ${category} ${command.keywords}`
  let score = 0
  for (const word of words) {
    const index = haystack.indexOf(word)
    if (index < 0) return null
    if (title === word) score += 100
    else if (title.startsWith(word)) score += 60
    else if (title.split(/\s+/).some((part) => part.startsWith(word))) score += 35
    else if (category.startsWith(word)) score += 20
    else score += Math.max(1, 12 - Math.min(index, 11))
  }
  return score
}

export function rankCommands(query: string, context: CommandContext): AppCommand[] {
  const words = normalizedWords(query)
  return APP_COMMANDS.map((command, index) => ({
    command,
    index,
    enabled: commandEnabled(command.id, context),
    score: commandScore(command, words)
  }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
    .sort((left, right) =>
      left.enabled === right.enabled
        ? right.score - left.score || left.index - right.index
        : Number(right.enabled) - Number(left.enabled)
    )
    .slice(0, 20)
    .map((entry) => entry.command)
}

export interface ShortcutEvent {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export function commandIdForShortcut(event: ShortcutEvent): AppCommandId | null {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return null
  const key = event.key.toLocaleLowerCase()
  if (key === '=' || key === '+') return 'font.increase'
  if (key === '_' || key === '-') return 'font.decrease'
  if (key === ')' || key === '0') return 'font.reset'
  return COMMAND_BY_KEY.get(key) ?? null
}
