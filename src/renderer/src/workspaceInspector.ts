import { computeLayout, listSurfaceIds, listTerminalSurfaceIds } from './layout/tree'
import type { LayoutNode } from './layout/types'

export interface WorkspaceSessionSummary {
  panes: number
  terminals: number
  previews: number
}

export function workspaceSessionSummary(root: LayoutNode): WorkspaceSessionSummary {
  const terminals = listTerminalSurfaceIds(root).length
  const surfaces = listSurfaceIds(root).length
  return {
    panes: computeLayout(root).panes.length,
    terminals,
    previews: surfaces - terminals
  }
}

export function localhostPreviewUrl(port: number): string | null {
  return Number.isInteger(port) && port >= 1 && port <= 65_535
    ? `http://localhost:${port}`
    : null
}
