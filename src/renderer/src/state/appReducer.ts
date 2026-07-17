import type { LayoutNode } from '../layout/types'
import {
  makePane,
  uid,
  firstPaneId,
  isValidLayoutNode,
  findPane,
  findPaneBySurfaceId,
  listSurfaceIds
} from '../layout/tree'
import { workspaceReducer, type WorkspaceState, type WorkspaceAction } from './workspaceReducer'
import { agentNeedsAttention, type AgentRecord, type AgentReport } from '../../../shared/agent'
import { normalizeWorkspaceName } from '../../../shared/workspace'
import { workspaceProjectName, type WorkspaceMetadata } from '../../../shared/workspaceMetadata'
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
  projectName: string
  gitRoot: string | null
  gitBranch: string | null
  metadataSurfaceId: string | null
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
export function makeWorkspace(name?: string, cwd = '~'): Workspace {
  const pane = makePane({ id: uid('term') })
  return {
    id: `ws-${crypto.randomUUID()}`,
    name: normalizeWorkspaceName(name ?? ''),
    cwd,
    projectName: workspaceProjectName(cwd),
    gitRoot: null,
    gitBranch: null,
    metadataSurfaceId: null,
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
 *  Startup restores only the previously active workspace so every launch begins
 *  with one workspace. Its layout/cwd survive, transient state is reset, and its
 *  terminals re-spawn fresh when their panes mount. See textbook/13. */
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
      projectName: workspaceProjectName(typeof entry.cwd === 'string' ? entry.cwd : '~'),
      gitRoot: null,
      gitBranch: null,
      metadataSurfaceId: null,
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
  const startupWorkspace = workspaces.find((workspace) => workspace.id === active) ?? workspaces[0]
  return { workspaces: [startupWorkspace], activeWorkspaceId: startupWorkspace.id, agents: [] }
}

/** Persist the active workspace layout only. Runtime workspaces remain independent,
 *  but relaunch is intentionally a one-workspace boundary. Transient status,
 *  unread, attention, agents, and usage are excluded. */
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
  const workspace =
    state.workspaces.find((candidate) => candidate.id === state.activeWorkspaceId) ??
    state.workspaces[0]
  return {
    workspaces: [
      {
        id: workspace.id,
        name: workspace.name,
        cwd: workspace.cwd,
        root: workspace.root,
        activePaneId: workspace.activePaneId
      }
    ],
    activeWorkspaceId: workspace.id
  }
}

export type AppAction =
  | { type: 'createWorkspace'; workspace: Workspace }
  | { type: 'selectWorkspace'; id: string }
  | { type: 'closeWorkspace'; id: string }
  | { type: 'renameWorkspace'; id: string; name: string }
  | { type: 'setWorkspaceMetadata'; id: string; metadata: WorkspaceMetadata }
  | { type: 'setStatus'; id: string; status: string | null }
  | { type: 'setAttention'; id: string; unread?: boolean; attention?: boolean }
  | { type: 'reportUsage'; id: string; report: UsageReport }
  | { type: 'reportAgent'; report: AgentReport }
  | { type: 'clearAgent'; id: string; source?: string }
  | { type: 'clearAgentsForSurface'; surfaceId: string }
  | { type: 'expireAgents'; now: number }
  | { type: 'focusAgent'; id: string }
  | { type: 'pane'; workspaceId: string; action: WorkspaceAction }

// ── Action creators ──────────────────────────────────────────────────────────
export function createWorkspaceAction(name?: string, cwd?: string): AppAction {
  return { type: 'createWorkspace', workspace: makeWorkspace(name, cwd) }
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

    case 'setWorkspaceMetadata':
      return mapWorkspace(state, action.id, (w) => {
        const activeSurfaceId = findPane(w.root, w.activePaneId)?.activeSurfaceId
        if (activeSurfaceId !== action.metadata.surfaceId) return w
        if (
          w.metadataSurfaceId === action.metadata.surfaceId &&
          w.cwd === action.metadata.cwd &&
          w.projectName === action.metadata.projectName &&
          w.gitRoot === action.metadata.gitRoot &&
          w.gitBranch === action.metadata.gitBranch
        ) {
          return w
        }
        return {
          ...w,
          cwd: action.metadata.cwd,
          projectName: action.metadata.projectName,
          gitRoot: action.metadata.gitRoot,
          gitBranch: action.metadata.gitBranch,
          metadataSurfaceId: action.metadata.surfaceId
        }
      })

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

    case 'clearAgentsForSurface': {
      const agents = state.agents.filter((agent) => agent.surfaceId !== action.surfaceId)
      return agents.length === state.agents.length
        ? state
        : refreshAgentAttention({ ...state, agents })
    }

    case 'expireAgents': {
      let changed = false
      const agents = state.agents.flatMap((agent) => {
        if (agent.expiresAt !== undefined && agent.expiresAt <= action.now) {
          changed = true
          return []
        }
        if (
          agent.staleAt !== undefined &&
          agent.staleAt <= action.now &&
          agent.state !== 'unknown'
        ) {
          changed = true
          const staleAgent: AgentRecord = {
            ...agent,
            state: 'unknown',
            message: 'State report became stale'
          }
          delete staleAgent.activity
          delete staleAgent.blockReason
          return [staleAgent]
        }
        return [agent]
      })
      return changed ? refreshAgentAttention({ ...state, agents }) : state
    }

    case 'focusAgent': {
      const agent = state.agents.find((candidate) => candidate.agentId === action.id)
      if (!agent) return state
      const workspace = state.workspaces.find((candidate) => candidate.id === agent.workspaceId)
      if (!workspace || !findPaneBySurfaceId(workspace.root, agent.surfaceId)) return state
      const previousSurfaceId = findPane(workspace.root, workspace.activePaneId)?.activeSurfaceId
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
                ...(previousSurfaceId !== agent.surfaceId
                  ? {
                      projectName: workspaceProjectName(candidate.cwd),
                      gitRoot: null,
                      gitBranch: null,
                      metadataSurfaceId: null
                    }
                  : {}),
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
        const previousSurfaceId = findPane(w.root, w.activePaneId)?.activeSurfaceId
        const sub: WorkspaceState = { root: w.root, activePaneId: w.activePaneId }
        const workspace = workspaceReducer(sub, action.action)
        const nextSurfaceId = findPane(workspace.root, workspace.activePaneId)?.activeSurfaceId
        return {
          ...w,
          root: workspace.root,
          activePaneId: workspace.activePaneId,
          ...(previousSurfaceId !== nextSurfaceId
            ? {
                projectName: workspaceProjectName(w.cwd),
                gitRoot: null,
                gitBranch: null,
                metadataSurfaceId: null
              }
            : {})
        }
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
