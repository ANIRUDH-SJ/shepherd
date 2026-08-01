export type TabNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

const TAB_NAVIGATION_KEYS: TabNavigationKey[] = ['ArrowLeft', 'ArrowRight', 'Home', 'End']

export function tabNavigationTarget(
  surfaceIds: string[],
  currentId: string,
  key: string
): string | undefined {
  if (surfaceIds.length === 0 || !TAB_NAVIGATION_KEYS.includes(key as TabNavigationKey)) {
    return undefined
  }
  if (key === 'Home') return surfaceIds[0]
  if (key === 'End') return surfaceIds.at(-1)

  const currentIndex = Math.max(0, surfaceIds.indexOf(currentId))
  const delta = key === 'ArrowLeft' ? -1 : 1
  return surfaceIds[(currentIndex + delta + surfaceIds.length) % surfaceIds.length]
}

export function terminalTabId(surfaceId: string): string {
  return `terminal-tab-${surfaceId}`
}

export function terminalPanelId(surfaceId: string): string {
  return `terminal-panel-${surfaceId}`
}

export function terminalWorkspaceAriaLabel(
  workspaceName: string,
  paneCount: number,
  terminalCount: number
): string {
  const panes = `${paneCount} ${paneCount === 1 ? 'pane' : 'panes'}`
  const terminals = `${terminalCount} ${terminalCount === 1 ? 'terminal' : 'terminals'}`
  return `${workspaceName}, ${panes}, ${terminals}`
}
