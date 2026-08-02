import {
  initialTree,
  splitPane,
  closePane,
  addSurface,
  closeSurface,
  setActiveSurface,
  resizeSplit,
  makePane,
  makeSurface,
  findPane,
  firstPaneId,
  makePreviewSurface,
  updatePreviewSurfaceUrl,
  listTerminalSurfaceIds
} from '../layout/tree'
import type { LayoutNode, Pane, Surface } from '../layout/types'
import { normalizePreviewUrl } from '../../../shared/preview'

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE REDUCER
// State = one immutable layout tree + the active pane id.
//
// IMPORTANT: the reducer is PURE — it never mints panes/surfaces and never uses
// randomness. New panes/surfaces are created by the ACTION CREATORS below (called
// from event handlers, which run once). React StrictMode double-invokes reducers
// in dev to catch impurity; if we minted (and numbered) terminals inside the
// reducer, every action would create two — that was the "Terminal N" numbering bug.
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkspaceState {
  root: LayoutNode
  activePaneId: string
}

export type WorkspaceAction =
  | { type: 'split'; paneId: string; direction: 'row' | 'column'; newPane: Pane }
  | { type: 'closePane'; paneId: string }
  | { type: 'newSurface'; paneId: string; surface: Surface }
  | { type: 'closeSurface'; paneId: string; surfaceId: string }
  | { type: 'setActiveSurface'; paneId: string; surfaceId: string }
  | { type: 'setActivePane'; paneId: string }
  | { type: 'updatePreviewUrl'; surfaceId: string; url: string }
  | { type: 'resize'; splitId: string; index: number; deltaFraction: number }

export function initialWorkspace(): WorkspaceState {
  return initialTree()
}

// ── Action creators (mint new terminals — call ONLY from event handlers) ──────
export function splitAction(paneId: string, direction: 'row' | 'column'): WorkspaceAction {
  return { type: 'split', paneId, direction, newPane: makePane(makeSurface()) }
}
export function newSurfaceAction(paneId: string): WorkspaceAction {
  return { type: 'newSurface', paneId, surface: makeSurface() }
}
export function previewSplitAction(paneId: string, url: string): WorkspaceAction {
  return {
    type: 'split',
    paneId,
    direction: 'row',
    newPane: makePane(makePreviewSurface(url))
  }
}
export function updatePreviewUrlAction(surfaceId: string, url: string): WorkspaceAction | null {
  const normalized = normalizePreviewUrl(url)
  return normalized.ok && normalized.url
    ? { type: 'updatePreviewUrl', surfaceId, url: normalized.url }
    : null
}

/** Pick a valid active pane after the tree changed. */
function reselect(root: LayoutNode, preferred: string): string {
  return findPane(root, preferred) ? preferred : firstPaneId(root)
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'split':
      return {
        root: splitPane(state.root, action.paneId, action.direction, action.newPane),
        activePaneId: action.newPane.id
      }

    case 'closePane': {
      const pane = findPane(state.root, action.paneId)
      if (!pane) return state
      const paneTerminalIds = new Set(
        pane.surfaces
          .filter((surface) => surface.panel.type === 'terminal')
          .map((surface) => surface.id)
      )
      if (listTerminalSurfaceIds(state.root).every((id) => paneTerminalIds.has(id))) return state
      const root = closePane(state.root, action.paneId)
      if (!root) return state // never remove the last pane
      return { root, activePaneId: reselect(root, state.activePaneId) }
    }

    case 'newSurface':
      return {
        root: addSurface(state.root, action.paneId, action.surface),
        activePaneId: action.paneId
      }

    case 'closeSurface': {
      const pane = findPane(state.root, action.paneId)
      if (!pane) return state
      const surface = pane.surfaces.find((candidate) => candidate.id === action.surfaceId)
      if (surface?.panel.type === 'terminal' && listTerminalSurfaceIds(state.root).length <= 1) {
        return state
      }
      // closing a pane's last tab closes the pane…
      if (pane.surfaces.length <= 1) {
        const root = closePane(state.root, action.paneId)
        if (!root) return state // …unless it's the very last pane in the app
        return { root, activePaneId: reselect(root, state.activePaneId) }
      }
      return { ...state, root: closeSurface(state.root, action.paneId, action.surfaceId) }
    }

    case 'setActiveSurface': {
      const pane = findPane(state.root, action.paneId)
      if (!pane?.surfaces.some((surface) => surface.id === action.surfaceId)) return state
      return {
        ...state,
        root: setActiveSurface(state.root, action.paneId, action.surfaceId),
        activePaneId: action.paneId
      }
    }

    case 'setActivePane':
      return state.activePaneId === action.paneId
        ? state
        : { ...state, activePaneId: action.paneId }

    case 'updatePreviewUrl':
      return { ...state, root: updatePreviewSurfaceUrl(state.root, action.surfaceId, action.url) }

    case 'resize':
      return {
        ...state,
        root: resizeSplit(state.root, action.splitId, action.index, action.deltaFraction)
      }

    default:
      return state
  }
}
