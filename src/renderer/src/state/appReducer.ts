import type { LayoutNode } from '../layout/types'
import {
  makePane,
  firstPaneId,
  isValidLayoutNode,
  findPane,
  findPaneBySurfaceId,
  listSurfaceIds,
  makeSurface,
  normalizeLayoutNode,
  activeTerminalSurfaceId
} from '../layout/tree'
import { workspaceReducer, type WorkspaceState, type WorkspaceAction } from './workspaceReducer'
import { agentNeedsAttention, type AgentRecord, type AgentReport } from '../../../shared/agent'
import { normalizeWorkspaceName } from '../../../shared/workspace'
import {
  workspaceProjectName,
  type WorkspaceMetadata,
  type WorkspacePullRequest
} from '../../../shared/workspaceMetadata'
import {
  addWorkspaceUsage,
  emptyWorkspaceUsage,
  type UsageReport,
  type WorkspaceUsage
} from '../../../shared/usage'
import {
  addInboxNotification,
  clearResolvedNotifications,
  markWorkspaceNotificationsRead,
  resolveNotification,
  resolveNotificationsForSubject,
  sanitizeNotificationInbox,
  workspaceNotificationCounts,
  type InboxNotification,
  type NotificationInput
} from './notificationInbox'

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
  pullRequest: WorkspacePullRequest | null
  ports: number[]
  metadataSurfaceId: string | null
  // the M2 layout state:
  root: LayoutNode
  activePaneId: string
  // sidebar metadata (populated by the socket server in Stage 2):
  status: string | null // subtitle line, e.g. "Claude is waiting for your input"
  unread: boolean // new activity → a quiet badge
  attention: boolean // an agent is blocked on you right now → the ring/flash
  attentionPulse: number // increments to remount one brief pane attention ring
  agentUnread: boolean // a blocked/done agent changed while this workspace was inactive
  agentAttention: boolean // an actionable blocked agent is currently in this workspace
  usage: WorkspaceUsage // ephemeral, agent-reported token/cost telemetry
}

export interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string
  agents: AgentRecord[]
  notifications: InboxNotification[]
}

/** Mint a new workspace with one terminal. The display NAME is positional
 *  ("workspace N", by sidebar position) unless a custom `name` is given. */
export function makeWorkspace(name?: string, cwd = '~'): Workspace {
  const pane = makePane(makeSurface())
  return {
    id: `ws-${crypto.randomUUID()}`,
    name: normalizeWorkspaceName(name ?? ''),
    cwd,
    projectName: workspaceProjectName(cwd),
    gitRoot: null,
    gitBranch: null,
    pullRequest: null,
    ports: [],
    metadataSurfaceId: null,
    root: { type: 'pane', pane },
    activePaneId: pane.id,
    status: null,
    unread: false,
    attention: false,
    attentionPulse: 0,
    agentUnread: false,
    agentAttention: false,
    usage: emptyWorkspaceUsage()
  }
}

export function initialApp(): AppState {
  const ws = makeWorkspace() // positional name → "workspace 1"
  return { workspaces: [ws], activeWorkspaceId: ws.id, agents: [], notifications: [] }
}

/** Validate + normalise a restored session into an AppState (or null if unusable).
 *  Startup restores only the previously active workspace so every launch begins
 *  with one workspace. Its layout/cwd and owned bounded inbox survive; live state
 *  resets, and its terminals re-spawn fresh when their panes mount. See textbook/13. */
export function sanitizeRestored(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { workspaces?: unknown; activeWorkspaceId?: unknown; notifications?: unknown }
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
    const root = normalizeLayoutNode(entry.root)
    if (!root) return null
    workspaces.push({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : '',
      cwd: typeof entry.cwd === 'string' ? entry.cwd : '~',
      projectName: workspaceProjectName(typeof entry.cwd === 'string' ? entry.cwd : '~'),
      gitRoot: null,
      gitBranch: null,
      pullRequest: null,
      ports: [],
      metadataSurfaceId: null,
      root,
      activePaneId: typeof entry.activePaneId === 'string' ? entry.activePaneId : firstPaneId(root),
      status: null,
      unread: false,
      attention: false,
      attentionPulse: 0,
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
  const notifications = sanitizeNotificationInbox(r.notifications, new Set([startupWorkspace.id]))
  return refreshNotificationMarkers({
    workspaces: [startupWorkspace],
    activeWorkspaceId: startupWorkspace.id,
    agents: [],
    notifications
  })
}

/** Persist the active workspace layout and its bounded notification inbox.
 *  Runtime workspaces remain independent, and relaunch is intentionally a
 *  one-workspace boundary. Status, pulse state, agents, and usage are excluded. */
export function toLayoutSnapshot(state: AppState): {
  workspaces: Array<{
    id: string
    name: string
    cwd: string
    root: LayoutNode
    activePaneId: string
  }>
  activeWorkspaceId: string
  notifications: InboxNotification[]
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
    activeWorkspaceId: workspace.id,
    notifications: state.notifications.filter(
      (notification) => notification.workspaceId === workspace.id
    )
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
  | { type: 'receiveNotification'; notification: NotificationInput }
  | { type: 'markWorkspaceNotificationsRead'; id: string }
  | { type: 'resolveNotification'; id: string }
  | { type: 'clearResolvedNotifications' }
  | { type: 'focusNotification'; id: string }
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

function refreshNotificationMarkers(state: AppState): AppState {
  return {
    ...state,
    workspaces: state.workspaces.map((workspace) => {
      const counts = workspaceNotificationCounts(state.notifications, workspace.id)
      return workspace.unread === counts.unread > 0
        ? workspace
        : { ...workspace, unread: counts.unread > 0 }
    })
  }
}

function resolveNotificationsForSurface(
  notifications: readonly InboxNotification[],
  surfaceId: string
): InboxNotification[] {
  return notifications.map((notification) =>
    notification.surfaceId === surfaceId && !notification.resolved
      ? { ...notification, unread: false, resolved: true }
      : notification
  )
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
  const previousWasNotifying = previous?.state === 'blocked' || previous?.state === 'done'
  const eventChanged =
    !previous || previous.state !== report.state || previous.message !== report.message
  let notifications = state.notifications
  if (unread && eventChanged) {
    notifications = addInboxNotification(notifications, {
      id: `agent:${report.agentId}:${revision}`,
      workspaceId: report.workspaceId,
      surfaceId: report.surfaceId,
      subjectId: report.agentId,
      title: report.displayName,
      body:
        report.message ??
        (report.state === 'blocked' ? 'Waiting for your attention' : 'Completed work'),
      source: 'agent',
      severity: report.state === 'blocked' ? 'attention' : 'info',
      createdAt: report.updatedAt
    })
  } else if (!unread && previousWasNotifying) {
    notifications = resolveNotificationsForSubject(notifications, report.agentId)
  }
  const next: AppState = {
    ...state,
    agents,
    notifications,
    workspaces: state.workspaces.map((candidate) =>
      candidate.id === report.workspaceId && unread
        ? {
            ...candidate,
            agentUnread: candidate.id !== state.activeWorkspaceId || candidate.agentUnread,
            attentionPulse:
              report.state === 'blocked' && eventChanged
                ? candidate.attentionPulse + 1
                : candidate.attentionPulse
          }
        : candidate
    )
  }
  return refreshNotificationMarkers(refreshAgentAttention(next))
}

function clearAgent(state: AppState, id: string, source?: string): AppState {
  const target = state.agents.find((agent) => agent.agentId === id)
  if (!target || (source !== undefined && target.source !== source)) return state
  return refreshNotificationMarkers(
    refreshAgentAttention({
      ...state,
      agents: state.agents.filter((agent) => agent.agentId !== id),
      notifications: resolveNotificationsForSubject(state.notifications, id)
    })
  )
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
      // Navigation is not acknowledgement. The explicit mark-read action clears
      // pending badges after the user has reviewed the destination.
      return {
        activeWorkspaceId: action.id,
        agents: state.agents,
        notifications: state.notifications,
        workspaces: state.workspaces.map((w) =>
          w.id === action.id
            ? {
                ...w,
                attention: false,
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
        agents: state.agents.filter((agent) => agent.workspaceId !== action.id),
        notifications: state.notifications.filter(
          (notification) => notification.workspaceId !== action.id
        )
      })
    }

    case 'renameWorkspace':
      return mapWorkspace(state, action.id, (w) => ({
        ...w,
        name: normalizeWorkspaceName(action.name)
      }))

    case 'setWorkspaceMetadata':
      return mapWorkspace(state, action.id, (w) => {
        const activeSurfaceId = activeTerminalSurfaceId(w.root, w.activePaneId)
        if (activeSurfaceId !== action.metadata.surfaceId) return w
        if (
          w.metadataSurfaceId === action.metadata.surfaceId &&
          w.cwd === action.metadata.cwd &&
          w.projectName === action.metadata.projectName &&
          w.gitRoot === action.metadata.gitRoot &&
          w.gitBranch === action.metadata.gitBranch &&
          w.pullRequest?.number === action.metadata.pullRequest?.number &&
          w.pullRequest?.state === action.metadata.pullRequest?.state &&
          w.pullRequest?.url === action.metadata.pullRequest?.url &&
          w.ports.length === action.metadata.ports.length &&
          w.ports.every((port, index) => port === action.metadata.ports[index])
        ) {
          return w
        }
        return {
          ...w,
          cwd: action.metadata.cwd,
          projectName: action.metadata.projectName,
          gitRoot: action.metadata.gitRoot,
          gitBranch: action.metadata.gitBranch,
          pullRequest: action.metadata.pullRequest,
          ports: action.metadata.ports,
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

    case 'receiveNotification': {
      const workspace = state.workspaces.find(
        (candidate) => candidate.id === action.notification.workspaceId
      )
      if (!workspace) return state
      const notification =
        action.notification.surfaceId &&
        !findPaneBySurfaceId(workspace.root, action.notification.surfaceId)
          ? { ...action.notification, surfaceId: null }
          : action.notification
      const notifications = addInboxNotification(state.notifications, notification)
      return refreshNotificationMarkers({
        ...state,
        notifications,
        workspaces: state.workspaces.map((candidate) =>
          candidate.id === notification.workspaceId && notification.severity === 'attention'
            ? {
                ...candidate,
                attention: true,
                attentionPulse: candidate.attentionPulse + 1
              }
            : candidate
        )
      })
    }

    case 'markWorkspaceNotificationsRead':
      return refreshNotificationMarkers({
        ...state,
        notifications: markWorkspaceNotificationsRead(state.notifications, action.id),
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === action.id
            ? { ...workspace, attention: false, agentUnread: false }
            : workspace
        )
      })

    case 'resolveNotification':
      return refreshNotificationMarkers({
        ...state,
        notifications: resolveNotification(state.notifications, action.id)
      })

    case 'clearResolvedNotifications':
      return refreshNotificationMarkers({
        ...state,
        notifications: clearResolvedNotifications(state.notifications)
      })

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
      const notifications = resolveNotificationsForSurface(state.notifications, action.surfaceId)
      return agents.length === state.agents.length && notifications === state.notifications
        ? state
        : refreshNotificationMarkers(refreshAgentAttention({ ...state, agents, notifications }))
    }

    case 'expireAgents': {
      let changed = false
      const clearedSubjects: string[] = []
      const agents = state.agents.flatMap((agent) => {
        if (agent.expiresAt !== undefined && agent.expiresAt <= action.now) {
          changed = true
          clearedSubjects.push(agent.agentId)
          return []
        }
        if (
          agent.staleAt !== undefined &&
          agent.staleAt <= action.now &&
          agent.state !== 'unknown'
        ) {
          changed = true
          clearedSubjects.push(agent.agentId)
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
      if (!changed) return state
      let notifications = state.notifications
      for (const subjectId of clearedSubjects) {
        notifications = resolveNotificationsForSubject(notifications, subjectId)
      }
      return refreshNotificationMarkers(refreshAgentAttention({ ...state, agents, notifications }))
    }

    case 'focusNotification': {
      const notification = state.notifications.find((candidate) => candidate.id === action.id)
      if (!notification || notification.resolved) return state
      const workspace = state.workspaces.find(
        (candidate) => candidate.id === notification.workspaceId
      )
      if (!workspace) return state
      const pane = notification.surfaceId
        ? findPaneBySurfaceId(workspace.root, notification.surfaceId)
        : null
      const previousSurfaceId = findPane(workspace.root, workspace.activePaneId)?.activeSurfaceId
      let focused: WorkspaceState = { root: workspace.root, activePaneId: workspace.activePaneId }
      if (pane && notification.surfaceId) {
        focused = workspaceReducer(focused, { type: 'setActivePane', paneId: pane.id })
        focused = workspaceReducer(focused, {
          type: 'setActiveSurface',
          paneId: pane.id,
          surfaceId: notification.surfaceId
        })
      }
      const notifications = state.notifications.map((candidate) =>
        candidate.id === action.id ? { ...candidate, unread: false } : candidate
      )
      return refreshNotificationMarkers(
        refreshAgentAttention({
          ...state,
          activeWorkspaceId: workspace.id,
          notifications,
          workspaces: state.workspaces.map((candidate) =>
            candidate.id === workspace.id
              ? {
                  ...candidate,
                  ...focused,
                  ...(notification.surfaceId && previousSurfaceId !== notification.surfaceId
                    ? {
                        projectName: workspaceProjectName(candidate.cwd),
                        gitRoot: null,
                        gitBranch: null,
                        pullRequest: null,
                        ports: [],
                        metadataSurfaceId: null
                      }
                    : {}),
                  attention: false,
                  agentAttention: false
                }
              : candidate
          )
        })
      )
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
      return refreshNotificationMarkers(
        refreshAgentAttention({
          ...state,
          activeWorkspaceId: workspace.id,
          notifications: markWorkspaceNotificationsRead(state.notifications, workspace.id),
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
                        pullRequest: null,
                        ports: [],
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
      )
    }

    case 'pane': {
      const next = mapWorkspace(state, action.workspaceId, (w) => {
        const previousSurfaceId = activeTerminalSurfaceId(w.root, w.activePaneId)
        const sub: WorkspaceState = { root: w.root, activePaneId: w.activePaneId }
        const workspace = workspaceReducer(sub, action.action)
        const nextSurfaceId = activeTerminalSurfaceId(workspace.root, workspace.activePaneId)
        return {
          ...w,
          root: workspace.root,
          activePaneId: workspace.activePaneId,
          ...(previousSurfaceId !== nextSurfaceId
            ? {
                projectName: workspaceProjectName(w.cwd),
                gitRoot: null,
                gitBranch: null,
                pullRequest: null,
                ports: [],
                metadataSurfaceId: null
              }
            : {})
        }
      })
      const workspace = next.workspaces.find((candidate) => candidate.id === action.workspaceId)
      if (!workspace) return next
      const surfaces = new Set(listSurfaceIds(workspace.root))
      const removedSurfaceIds = new Set(
        listSurfaceIds(
          state.workspaces.find((candidate) => candidate.id === action.workspaceId)?.root ??
            workspace.root
        ).filter((surfaceId) => !surfaces.has(surfaceId))
      )
      const notifications = next.notifications.map((notification) =>
        notification.workspaceId === action.workspaceId &&
        notification.surfaceId !== null &&
        removedSurfaceIds.has(notification.surfaceId) &&
        !notification.resolved
          ? { ...notification, unread: false, resolved: true }
          : notification
      )
      return refreshNotificationMarkers(
        refreshAgentAttention({
          ...next,
          notifications,
          agents: next.agents.filter(
            (agent) => agent.workspaceId !== action.workspaceId || surfaces.has(agent.surfaceId)
          )
        })
      )
    }

    default:
      return state
  }
}
