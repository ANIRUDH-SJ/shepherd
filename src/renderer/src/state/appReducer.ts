import type { LayoutNode } from '../layout/types'
import { initialTree } from '../layout/tree'
import { workspaceReducer, type WorkspaceState, type WorkspaceAction } from './workspaceReducer'

// ─────────────────────────────────────────────────────────────────────────────
// APP REDUCER  (the top of the object model: Window → Workspace → …)
// State = a list of workspaces + which one is active. Each workspace owns its own
// pane tree (the M2 state) plus sidebar metadata. Pane actions are delegated to
// the pure workspaceReducer. Like M2, the reducer is PURE — new workspaces are
// minted by action creators in event handlers (StrictMode-safe). See textbook/09.
// ─────────────────────────────────────────────────────────────────────────────

export interface Workspace {
  id: string
  name: string
  cwd: string
  // the M2 layout state:
  root: LayoutNode
  activePaneId: string
  // sidebar metadata (populated by the socket server in Stage 2):
  status: string | null // subtitle line, e.g. "Claude is waiting for your input"
  unread: boolean // new activity → a quiet badge
  attention: boolean // an agent is blocked on you right now → the ring/flash
}

export interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string
}

let wsCounter = 0

/** Mint a new workspace (side effects: uuid + name counter). Call from handlers only. */
export function makeWorkspace(name?: string): Workspace {
  wsCounter += 1
  const { root, activePaneId } = initialTree()
  return {
    id: `ws-${crypto.randomUUID()}`,
    name: name ?? `workspace ${wsCounter}`,
    cwd: '~',
    root,
    activePaneId,
    status: null,
    unread: false,
    attention: false
  }
}

export function initialApp(): AppState {
  const ws = makeWorkspace('main')
  return { workspaces: [ws], activeWorkspaceId: ws.id }
}

export type AppAction =
  | { type: 'createWorkspace'; workspace: Workspace }
  | { type: 'selectWorkspace'; id: string }
  | { type: 'closeWorkspace'; id: string }
  | { type: 'renameWorkspace'; id: string; name: string }
  | { type: 'setStatus'; id: string; status: string | null }
  | { type: 'setAttention'; id: string; unread?: boolean; attention?: boolean }
  | { type: 'pane'; workspaceId: string; action: WorkspaceAction }

// ── Action creators ──────────────────────────────────────────────────────────
export function createWorkspaceAction(name?: string): AppAction {
  return { type: 'createWorkspace', workspace: makeWorkspace(name) }
}
/** Wrap a pane-level (M2) action so it targets a specific workspace's tree. */
export function paneAction(workspaceId: string, action: WorkspaceAction): AppAction {
  return { type: 'pane', workspaceId, action }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function mapWorkspace(state: AppState, id: string, fn: (w: Workspace) => Workspace): AppState {
  return { ...state, workspaces: state.workspaces.map((w) => (w.id === id ? fn(w) : w)) }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'createWorkspace':
      return { workspaces: [...state.workspaces, action.workspace], activeWorkspaceId: action.workspace.id }

    case 'selectWorkspace': {
      if (!state.workspaces.some((w) => w.id === action.id)) return state
      // Looking at a workspace clears its unread/attention.
      return {
        activeWorkspaceId: action.id,
        workspaces: state.workspaces.map((w) =>
          w.id === action.id ? { ...w, unread: false, attention: false } : w
        )
      }
    }

    case 'closeWorkspace': {
      if (state.workspaces.length <= 1) return state // keep at least one
      const workspaces = state.workspaces.filter((w) => w.id !== action.id)
      const activeWorkspaceId =
        state.activeWorkspaceId === action.id ? workspaces[0].id : state.activeWorkspaceId
      return { workspaces, activeWorkspaceId }
    }

    case 'renameWorkspace':
      return mapWorkspace(state, action.id, (w) => ({ ...w, name: action.name }))

    case 'setStatus':
      return mapWorkspace(state, action.id, (w) => ({ ...w, status: action.status }))

    case 'setAttention':
      return mapWorkspace(state, action.id, (w) => ({
        ...w,
        unread: action.unread ?? w.unread,
        attention: action.attention ?? w.attention
      }))

    case 'pane':
      return mapWorkspace(state, action.workspaceId, (w) => {
        const sub: WorkspaceState = { root: w.root, activePaneId: w.activePaneId }
        const next = workspaceReducer(sub, action.action)
        return { ...w, root: next.root, activePaneId: next.activePaneId }
      })

    default:
      return state
  }
}
