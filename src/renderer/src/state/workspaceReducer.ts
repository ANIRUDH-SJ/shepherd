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
  firstPaneId
} from '../layout/tree'
import type { LayoutNode } from '../layout/types'

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE REDUCER
// All layout state lives here as one immutable tree + the active pane id. Every
// user action (split, close, new tab…) is a pure transition over the tree ops
// from ../layout/tree. See textbook/08 (React state) and /10 (tiling).
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkspaceState {
  root: LayoutNode
  activePaneId: string
}

export type WorkspaceAction =
  | { type: 'split'; paneId: string; direction: 'row' | 'column' }
  | { type: 'closePane'; paneId: string }
  | { type: 'newSurface'; paneId: string }
  | { type: 'closeSurface'; paneId: string; surfaceId: string }
  | { type: 'setActiveSurface'; paneId: string; surfaceId: string }
  | { type: 'setActivePane'; paneId: string }
  | { type: 'resize'; splitId: string; index: number; deltaFraction: number }

export function initialWorkspace(): WorkspaceState {
  return initialTree()
}

/** Pick a valid active pane after the tree changed. */
function reselect(root: LayoutNode, preferred: string): string {
  return findPane(root, preferred) ? preferred : firstPaneId(root)
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'split': {
      const newPane = makePane(makeSurface())
      return { root: splitPane(state.root, action.paneId, action.direction, newPane), activePaneId: newPane.id }
    }

    case 'closePane': {
      const root = closePane(state.root, action.paneId)
      if (!root) return state // never remove the last pane
      return { root, activePaneId: reselect(root, state.activePaneId) }
    }

    case 'newSurface':
      return { root: addSurface(state.root, action.paneId, makeSurface()), activePaneId: action.paneId }

    case 'closeSurface': {
      const pane = findPane(state.root, action.paneId)
      if (!pane) return state
      // closing the pane's last tab closes the pane itself…
      if (pane.surfaces.length <= 1) {
        const root = closePane(state.root, action.paneId)
        if (!root) return state // …unless it's the very last pane in the app
        return { root, activePaneId: reselect(root, state.activePaneId) }
      }
      return { ...state, root: closeSurface(state.root, action.paneId, action.surfaceId) }
    }

    case 'setActiveSurface':
      return { ...state, root: setActiveSurface(state.root, action.paneId, action.surfaceId) }

    case 'setActivePane':
      return state.activePaneId === action.paneId ? state : { ...state, activePaneId: action.paneId }

    case 'resize':
      return { ...state, root: resizeSplit(state.root, action.splitId, action.index, action.deltaFraction) }

    default:
      return state
  }
}
