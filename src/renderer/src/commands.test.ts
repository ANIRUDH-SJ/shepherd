import {
  APP_COMMANDS,
  commandEnabled,
  commandIdForShortcut,
  rankCommands,
  type CommandContext
} from './commands'

let failures = 0
function assert(condition: unknown, message: string): void {
  if (condition) console.log(`  ok: ${message}`)
  else {
    console.error(`FAIL: ${message}`)
    failures++
  }
}

const idle: CommandContext = {
  workspaceCount: 1,
  paneCount: 1,
  terminalCount: 1,
  surfaceCount: 1,
  activePanelType: 'terminal',
  activeSurfaceClosable: false,
  activePaneClosable: false,
  unreadNotificationCount: 0,
  sidebarCollapsed: false
}
const busy: CommandContext = {
  workspaceCount: 3,
  paneCount: 2,
  terminalCount: 4,
  surfaceCount: 5,
  activePanelType: 'preview',
  activeSurfaceClosable: true,
  activePaneClosable: true,
  unreadNotificationCount: 2,
  sidebarCollapsed: true
}

assert(
  new Set(APP_COMMANDS.map((command) => command.id)).size === APP_COMMANDS.length,
  'command ids are unique'
)
assert(
  new Set(APP_COMMANDS.flatMap((command) => command.shortcut ?? [])).size ===
    APP_COMMANDS.filter((command) => command.shortcut).length,
  'registered shortcuts are unique'
)
assert(
  rankCommands('', idle)[0]?.id === 'terminal.find',
  'empty query keeps intentional command order'
)
assert(
  rankCommands('split down', idle)[0]?.id === 'pane.split-down',
  'ranks an exact multi-token title first'
)
assert(rankCommands('zoom reset', idle)[0]?.id === 'font.reset', 'ranks command keywords')
assert(
  rankCommands('local server', idle)[0]?.id === 'preview.open',
  'discovers localhost preview by workflow keywords'
)
assert(
  rankCommands('repository agents', idle)[0]?.id === 'workspace.inspect',
  'discovers the contextual workspace inspector by its details'
)
assert(
  rankCommands('no such operation', idle).length === 0,
  'hides commands with no matching token'
)
assert(!commandEnabled('workspace.close', idle), 'disables closing the last workspace')
assert(commandEnabled('workspace.close', busy), 'enables closing among several workspaces')
assert(!commandEnabled('terminal.find', busy), 'disables terminal find on a preview panel')
assert(commandEnabled('surface.close', busy), 'allows closing a preview among several surfaces')
assert(
  !commandEnabled('notification.jump-unread', idle),
  'disables unread navigation without unread work'
)
assert(commandEnabled('notification.jump-unread', busy), 'enables unread navigation contextually')
assert(
  commandIdForShortcut({
    key: 'F',
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false
  }) === 'terminal.find',
  'maps shortcut keys case-insensitively'
)
assert(
  commandIdForShortcut({
    key: '?',
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false
  }) === 'help.open',
  'maps shifted punctuation shortcuts'
)
assert(
  commandIdForShortcut({
    key: '<',
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false
  }) === 'settings.open',
  'normalizes the shifted settings shortcut'
)
assert(
  commandIdForShortcut({
    key: 'f',
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false
  }) === null,
  'does not steal ordinary terminal control keys'
)
assert(
  commandIdForShortcut({
    key: 'f',
    ctrlKey: true,
    shiftKey: true,
    altKey: true,
    metaKey: false
  }) === null,
  'rejects conflicting modifiers'
)

if (failures > 0) throw new Error(`${failures} terminal command test(s) failed`)
console.log('\n✅ ALL TERMINAL COMMAND TESTS PASS')
