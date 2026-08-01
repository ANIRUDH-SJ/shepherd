import type { Pane } from './layout/types'

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

export interface TerminalContextSummary {
  focusLabel: string
  countLabel: string
}

export function terminalContextSummary(
  panes: Pane[],
  activePaneId: string,
  surfaceNumbers: Map<string, number>
): TerminalContextSummary {
  const activePaneIndex = panes.findIndex((pane) => pane.id === activePaneId)
  const activePane = activePaneIndex >= 0 ? panes[activePaneIndex] : panes[0]
  const paneNumber = activePaneIndex >= 0 ? activePaneIndex + 1 : activePane ? 1 : undefined
  const terminalNumber = activePane ? surfaceNumbers.get(activePane.activeSurfaceId) : undefined
  const paneCount = panes.length
  const terminalCount = surfaceNumbers.size

  return {
    focusLabel:
      paneNumber && terminalNumber
        ? `Pane ${paneNumber} · Terminal ${terminalNumber}`
        : 'No active terminal',
    countLabel: `${paneCount} ${paneCount === 1 ? 'pane' : 'panes'} · ${terminalCount} ${terminalCount === 1 ? 'terminal' : 'terminals'}`
  }
}
