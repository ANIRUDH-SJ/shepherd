import type { LayoutNode } from '../layout/types'
import { makePane, uid, firstPaneId, isValidLayoutNode } from '../layout/tree'
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

/** Mint a new workspace with one terminal. The display NAME is positional
 *  ("workspace N", by sidebar position) unless a custom `name` is given. */
export function makeWorkspace(name?: string): Workspace {
  const pane = makePane({ id: uid('term') })
  return {
    id: `ws-${crypto.randomUUID()}`,
    name: name ?? '',
    cwd: '~',
    root: { type: 'pane', pane },
    activePaneId: pane.id,
    status: null,
    unread: false,
    attention: false
  }
}

export function initialApp(): AppState {
  const ws = makeWorkspace() // positional name → "workspace 1"
  return { workspaces: [ws], activeWorkspaceId: ws.id }
}

/** Validate + normalise a restored session into an AppState (or null if unusable).
 *  We restore only the LAYOUT — transient flags (status/unread/attention) are reset,
 *  and terminals re-spawn fresh when their panes mount. See textbook/13. */
export function sanitizeRestored(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { workspaces?: unknown; activeWorkspaceId?: unknown }
  if (!Array.isArray(r.workspaces) || r.workspaces.length === 0) return null

  const workspaces: Workspace[] = []
  for (const item of r.workspaces) {
    if (!item || typeof item !== 'object') return null
    const entry = item as Record<string, unknown>
    // Deep-validate the tree so a corrupt snapshot fails CLOSED (fresh app) instead
    // of crashing later in firstPaneId / computeLayout.
    if (typeof entry.id !== 'string' || !isValidLayoutNode(entry.root)) {
      return null
    }
    const root = entry.root as LayoutNode
    workspaces.push({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : '',
      cwd: typeof entry.cwd === 'string' ? entry.cwd : '~',
      root,
      activePaneId: typeof entry.activePaneId === 'string' ? entry.activePaneId : firstPaneId(root),
      status: null,
      unread: false,
      attention: false
    })
  }
  const active =
    typeof r.activeWorkspaceId === 'string' && workspaces.some((w) => w.id === r.activeWorkspaceId)
      ? r.activeWorkspaceId
      : workspaces[0].id
  return { workspaces, activeWorkspaceId: active }
}

/** The serialisable LAYOUT of the app (no transient status/unread/attention) — this
 *  is what we persist, so agent status churn doesn't cause needless saves. */
export function toLayoutSnapshot(state: AppState): {
  workspaces: Array<{ id: string; name: string; cwd: string; root: LayoutNode; activePaneId: string }>
  activeWorkspaceId: string
} {
  return {
    workspaces: state.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      cwd: w.cwd,
      root: w.root,
      activePaneId: w.activePaneId
    })),
    activeWorkspaceId: state.activeWorkspaceId
  }
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
