import type { LayoutNode } from '../layout/types'
import {
  makePane,
  uid,
  firstPaneId,
  isValidLayoutNode,
  findPaneBySurfaceId,
  listSurfaceIds
} from '../layout/tree'
import { workspaceReducer, type WorkspaceState, type WorkspaceAction } from './workspaceReducer'
import { agentNeedsAttention, type AgentRecord, type AgentReport } from '../../../shared/agent'
import { normalizeWorkspaceName } from '../../../shared/workspace'
import {
  addWorkspaceUsage,
  emptyWorkspaceUsage,
  type UsageReport,
  type WorkspaceUsage
} from '../../../shared/usage'

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
  agentUnread: boolean // a blocked/done agent changed while this workspace was inactive
  agentAttention: boolean // an actionable blocked agent is currently in this workspace
  usage: WorkspaceUsage // ephemeral, agent-reported token/cost telemetry
}

export interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string
  agents: AgentRecord[]
}

/** Mint a new workspace with one terminal. The display NAME is positional
 *  ("workspace N", by sidebar position) unless a custom `name` is given. */
export function makeWorkspace(name?: string): Workspace {
  const pane = makePane({ id: uid('term') })
  return {
    id: `ws-${crypto.randomUUID()}`,
    name: normalizeWorkspaceName(name ?? ''),
    cwd: '~',
    root: { type: 'pane', pane },
    activePaneId: pane.id,
    status: null,
    unread: false,
    attention: false,
    agentUnread: false,
    agentAttention: false,
    usage: emptyWorkspaceUsage()
  }
}

export function initialApp(): AppState {
  const ws = makeWorkspace() // positional name → "workspace 1"
  return { workspaces: [ws], activeWorkspaceId: ws.id, agents: [] }
}

/** Validate + normalise a restored session into an AppState (or null if unusable).
 *  We restore only the LAYOUT — transient flags and usage telemetry are reset,
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
      attention: false,
      agentUnread: false,
      agentAttention: false,
      usage: emptyWorkspaceUsage()
    })
  }
  const active =
    typeof r.activeWorkspaceId === 'string' && workspaces.some((w) => w.id === r.activeWorkspaceId)
      ? r.activeWorkspaceId
      : workspaces[0].id
  return { workspaces, activeWorkspaceId: active, agents: [] }
}

/** The serialisable LAYOUT of the app (no transient status/unread/attention) — this
 *  is what we persist, so agent status churn doesn't cause needless saves. */
export function toLayoutSnapshot(state: AppState): {
  workspaces: Array<{
    id: string
    name: string
    cwd: string
    root: LayoutNode
    activePaneId: string
  }>
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
  | { type: 'reportUsage'; id: string; report: UsageReport }
  | { type: 'reportAgent'; report: AgentReport }
  | { type: 'clearAgent'; id: string; source?: string }
  | { type: 'expireAgents'; now: number }
  | { type: 'focusAgent'; id: string }
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

function refreshAgentAttention(state: AppState): AppState {
  return {
    ...state,
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
      agentAttention:
        workspace.id !== state.activeWorkspaceId &&
        state.agents.some(
          (agent) => agent.workspaceId === workspace.id && agentNeedsAttention(agent)
        )
    }))
  }
}

function reportAgent(state: AppState, report: AgentReport): AppState {
  const workspace = state.workspaces.find((candidate) => candidate.id === report.workspaceId)
  if (!workspace) return state
  const pane = findPaneBySurfaceId(workspace.root, report.surfaceId)
  if (!pane) return state

  const index = state.agents.findIndex((agent) => agent.agentId === report.agentId)
  const previous = index >= 0 ? state.agents[index] : null
  if (
    previous &&
    (previous.source !== report.source ||
      previous.workspaceId !== report.workspaceId ||
      previous.surfaceId !== report.surfaceId)
  ) {
    return state
  }
  if (previous && report.revision !== undefined && report.revision <= previous.revision) {
    return state
  }

  const { revision: reportedRevision, ...fields } = report
  const revision = reportedRevision ?? (previous?.revision ?? -1) + 1
  const record: AgentRecord = { ...fields, paneId: pane.id, revision }
  const agents = [...state.agents]
  if (index >= 0) agents[index] = record
  else agents.push(record)

  const unread = report.state === 'blocked' || report.state === 'done'
  const next: AppState = {
    ...state,
    agents,
    workspaces: state.workspaces.map((candidate) =>
      candidate.id === report.workspaceId && candidate.id !== state.activeWorkspaceId && unread
        ? { ...candidate, agentUnread: true }
        : candidate
    )
  }
  return refreshAgentAttention(next)
}

function clearAgent(state: AppState, id: string, source?: string): AppState {
  const target = state.agents.find((agent) => agent.agentId === id)
  if (!target || (source !== undefined && target.source !== source)) return state
  return refreshAgentAttention({
    ...state,
    agents: state.agents.filter((agent) => agent.agentId !== id)
  })
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'createWorkspace':
      return refreshAgentAttention({
        ...state,
        workspaces: [...state.workspaces, action.workspace],
        activeWorkspaceId: action.workspace.id
      })

    case 'selectWorkspace': {
      if (!state.workspaces.some((w) => w.id === action.id)) return state
      // Looking at a workspace clears its unread/attention.
      return {
        activeWorkspaceId: action.id,
        agents: state.agents,
        workspaces: state.workspaces.map((w) =>
          w.id === action.id
            ? {
                ...w,
                unread: false,
                attention: false,
                agentUnread: false,
                agentAttention: false
              }
            : {
                ...w,
                agentAttention: state.agents.some(
                  (agent) => agent.workspaceId === w.id && agentNeedsAttention(agent)
                )
              }
        )
      }
    }

    case 'closeWorkspace': {
      if (state.workspaces.length <= 1) return state // keep at least one
      const workspaces = state.workspaces.filter((w) => w.id !== action.id)
      const activeWorkspaceId =
        state.activeWorkspaceId === action.id ? workspaces[0].id : state.activeWorkspaceId
      return refreshAgentAttention({
        workspaces,
        activeWorkspaceId,
        agents: state.agents.filter((agent) => agent.workspaceId !== action.id)
      })
    }

    case 'renameWorkspace':
      return mapWorkspace(state, action.id, (w) => ({
        ...w,
        name: normalizeWorkspaceName(action.name)
      }))

    case 'setStatus':
      return mapWorkspace(state, action.id, (w) => ({ ...w, status: action.status }))

    case 'setAttention':
      return mapWorkspace(state, action.id, (w) => ({
        ...w,
        unread: action.unread ?? w.unread,
        attention: action.attention ?? w.attention
      }))

    case 'reportUsage':
      return mapWorkspace(state, action.id, (w) => ({
        ...w,
        usage: addWorkspaceUsage(w.usage, action.report)
      }))

    case 'reportAgent':
      return reportAgent(state, action.report)

    case 'clearAgent':
      return clearAgent(state, action.id, action.source)

    case 'expireAgents': {
      const agents = state.agents.filter(
        (agent) => agent.expiresAt === undefined || agent.expiresAt > action.now
      )
      return agents.length === state.agents.length
        ? state
        : refreshAgentAttention({ ...state, agents })
    }

    case 'focusAgent': {
      const agent = state.agents.find((candidate) => candidate.agentId === action.id)
      if (!agent) return state
      const workspace = state.workspaces.find((candidate) => candidate.id === agent.workspaceId)
      if (!workspace || !findPaneBySurfaceId(workspace.root, agent.surfaceId)) return state
      let focused: WorkspaceState = { root: workspace.root, activePaneId: workspace.activePaneId }
      focused = workspaceReducer(focused, { type: 'setActivePane', paneId: agent.paneId })
      focused = workspaceReducer(focused, {
        type: 'setActiveSurface',
        paneId: agent.paneId,
        surfaceId: agent.surfaceId
      })
      return refreshAgentAttention({
        ...state,
        activeWorkspaceId: workspace.id,
        workspaces: state.workspaces.map((candidate) =>
          candidate.id === workspace.id
            ? {
                ...candidate,
                ...focused,
                unread: false,
                attention: false,
                agentUnread: false,
                agentAttention: false
              }
            : candidate
        )
      })
    }

    case 'pane': {
      const next = mapWorkspace(state, action.workspaceId, (w) => {
        const sub: WorkspaceState = { root: w.root, activePaneId: w.activePaneId }
        const workspace = workspaceReducer(sub, action.action)
        return { ...w, root: workspace.root, activePaneId: workspace.activePaneId }
      })
      const workspace = next.workspaces.find((candidate) => candidate.id === action.workspaceId)
      if (!workspace) return next
      const surfaces = new Set(listSurfaceIds(workspace.root))
      return refreshAgentAttention({
        ...next,
        agents: next.agents.filter(
          (agent) => agent.workspaceId !== action.workspaceId || surfaces.has(agent.surfaceId)
        )
      })
    }

    default:
      return state
  }
}
