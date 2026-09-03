import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  appReducer,
  initialApp,
  sanitizeRestored,
  toLayoutSnapshot,
  createWorkspaceAction,
  paneAction,
  type AppState
} from './state/appReducer'
import { splitAction, newSurfaceAction, previewSplitAction } from './state/workspaceReducer'
import {
  activeTerminalSurfaceId,
  computeLayout,
  findPane,
  findPaneBySurfaceId,
  listSurfaceIds,
  listTerminalSurfaceIds
} from './layout/tree'
import { bumpFontSize, resetFontSize } from './settings'
import type { AgentRecord, AgentReport } from '../../shared/agent'
import type { UsageReport } from '../../shared/usage'
import { isWorkspaceMetadata } from '../../shared/workspaceMetadata'
import { nextAgentLifecycleDeadline } from './agentTiming'
import { latestUnreadNotification } from './state/notificationInbox'
import { RENDERER_EVENT } from './events'
import {
  commandEnabled,
  commandIdForShortcut,
  type AppCommandId,
  type CommandContext
} from './commands'
import Sidebar from './components/Sidebar'
import WorkspaceView from './components/WorkspaceView'
import CommandPalette from './components/CommandPalette'
import ShortcutHelp from './components/ShortcutHelp'
import SettingsDialog from './components/SettingsDialog'
import PreviewPicker from './components/PreviewPicker'
import WorkspaceInspector from './components/WorkspaceInspector'

// Restore the saved session synchronously at startup, else start fresh. Computed
// once at module load. Optional chaining keeps it safe if the bridge isn't ready.
const INITIAL_APP = sanitizeRestored(window.api?.session?.loadSync?.() ?? null) ?? initialApp()

const MIN_SIDEBAR = 170
const MAX_SIDEBAR = 420
const DEFAULT_SIDEBAR = 240

type UtilityOverlay = 'palette' | 'help' | 'settings' | 'preview'

function commandContext(state: AppState, sidebarCollapsed: boolean): CommandContext {
  const workspace = state.workspaces.find((candidate) => candidate.id === state.activeWorkspaceId)
  const pane = workspace ? findPane(workspace.root, workspace.activePaneId) : null
  const activeSurface = pane?.surfaces.find((surface) => surface.id === pane.activeSurfaceId)
  const terminalCount = workspace ? listTerminalSurfaceIds(workspace.root).length : 0
  const surfaceCount = workspace ? listSurfaceIds(workspace.root).length : 0
  const paneCount = workspace ? computeLayout(workspace.root).panes.length : 0
  return {
    workspaceCount: state.workspaces.length,
    paneCount,
    terminalCount,
    surfaceCount,
    activePanelType: activeSurface?.panel.type ?? 'terminal',
    activeSurfaceClosable:
      activeSurface?.panel.type === 'preview' ? surfaceCount > 1 : terminalCount > 1,
    activePaneClosable:
      paneCount > 1 &&
      (pane?.surfaces.filter((surface) => surface.panel.type === 'terminal').length ?? 0) <
        terminalCount,
    unreadNotificationCount: state.notifications.filter(
      (notification) => notification.unread && !notification.resolved
    ).length,
    sidebarCollapsed
  }
}

// Key name → terminal escape sequence, for `shepherd send-key`.
const KEY_SEQ: Record<string, string> = {
  enter: '\r',
  tab: '\t',
  escape: '\x1b',
  backspace: '\x7f',
  delete: '\x1b[3~',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D'
}

// The app shell: owns the whole AppState, renders the sidebar + the stack of
// workspace views (only the active one visible), and the global keyboard map.
export default function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(appReducer, INITIAL_APP)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR)
  const [collapsed, setCollapsed] = useState(false)
  const [utilityOverlay, setUtilityOverlay] = useState<UtilityOverlay | null>(null)
  const [inspectorWorkspaceId, setInspectorWorkspaceId] = useState<string | null>(null)
  const notificationSequence = useRef(0)

  // Keep the latest state in a ref so the (once-installed) key handler sees it.
  const stateRef = useRef(state)
  stateRef.current = state
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed
  const utilityOverlayRef = useRef(utilityOverlay)
  utilityOverlayRef.current = utilityOverlay
  const executeCommandRef = useRef<(id: AppCommandId) => boolean>(() => false)
  executeCommandRef.current = (id): boolean => {
    const current = stateRef.current
    const context = commandContext(current, collapsedRef.current)
    if (!commandEnabled(id, context)) return false
    const workspace = current.workspaces.find(
      (candidate) => candidate.id === current.activeWorkspaceId
    )
    if (!workspace) return false
    const pane = findPane(workspace.root, workspace.activePaneId)

    if (id !== 'workspace.inspect') setInspectorWorkspaceId(null)

    if (
      id !== 'palette.open' &&
      id !== 'help.open' &&
      id !== 'settings.open' &&
      id !== 'preview.open'
    ) {
      setUtilityOverlay(null)
    }
    switch (id) {
      case 'terminal.find':
        if (
          !pane ||
          pane.surfaces.find((surface) => surface.id === pane.activeSurfaceId)?.panel.type !==
            'terminal'
        ) {
          return false
        }
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent(RENDERER_EVENT.terminalFind, {
              detail: { surfaceId: pane.activeSurfaceId }
            })
          )
        }, 0)
        break
      case 'palette.open':
        setUtilityOverlay('palette')
        break
      case 'terminal.new-tab':
        dispatch(paneAction(workspace.id, newSurfaceAction(workspace.activePaneId)))
        break
      case 'surface.close':
        if (!pane) return false
        dispatch(
          paneAction(workspace.id, {
            type: 'closeSurface',
            paneId: workspace.activePaneId,
            surfaceId: pane.activeSurfaceId
          })
        )
        break
      case 'pane.split-right':
        dispatch(paneAction(workspace.id, splitAction(workspace.activePaneId, 'row')))
        break
      case 'pane.split-down':
        dispatch(paneAction(workspace.id, splitAction(workspace.activePaneId, 'column')))
        break
      case 'pane.close':
        dispatch(paneAction(workspace.id, { type: 'closePane', paneId: workspace.activePaneId }))
        break
      case 'workspace.new':
        dispatch(createWorkspaceAction())
        break
      case 'workspace.close':
        dispatch({ type: 'closeWorkspace', id: workspace.id })
        break
      case 'workspace.previous':
      case 'workspace.next': {
        const index = current.workspaces.findIndex((candidate) => candidate.id === workspace.id)
        const delta = id === 'workspace.previous' ? -1 : 1
        const target =
          current.workspaces[
            (index + delta + current.workspaces.length) % current.workspaces.length
          ]
        dispatch({ type: 'selectWorkspace', id: target.id })
        break
      }
      case 'workspace.inspect':
        setInspectorWorkspaceId(workspace.id)
        break
      case 'sidebar.toggle':
        setCollapsed((value) => !value)
        break
      case 'notification.jump-unread': {
        const notification = latestUnreadNotification(current.notifications)
        if (!notification) return false
        dispatch({ type: 'focusNotification', id: notification.id })
        if (notification.surfaceId) {
          requestAnimationFrame(() => {
            window.dispatchEvent(
              new CustomEvent(RENDERER_EVENT.focusSurface, { detail: notification.surfaceId })
            )
          })
        }
        break
      }
      case 'notification.mark-read':
        dispatch({ type: 'markWorkspaceNotificationsRead', id: workspace.id })
        break
      case 'font.increase':
        bumpFontSize(1)
        break
      case 'font.decrease':
        bumpFontSize(-1)
        break
      case 'font.reset':
        resetFontSize()
        break
      case 'settings.open':
        setUtilityOverlay('settings')
        break
      case 'preview.open':
        setUtilityOverlay('preview')
        break
      case 'help.open':
        setUtilityOverlay('help')
        break
      default: {
        const exhaustive: never = id
        return exhaustive
      }
    }
    return true
  }
  const agentLifecycleDeadline = useMemo(
    () => nextAgentLifecycleDeadline(state.agents),
    [state.agents]
  )

  // Global keyboard shortcuts resolve through the same typed registry as the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const id = commandIdForShortcut(e)
      if (!id) return
      if (
        utilityOverlayRef.current &&
        id !== 'palette.open' &&
        id !== 'help.open' &&
        id !== 'settings.open' &&
        id !== 'preview.open'
      ) {
        return
      }
      if (!executeCommandRef.current(id)) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Mirror the workspace list to main so the socket server can resolve ids/names.
  useEffect(() => {
    window.api.socket.syncWorkspaces({
      workspaces: state.workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        activeSurfaceId: activeTerminalSurfaceId(w.root, w.activePaneId) ?? undefined
      })),
      activeWorkspaceId: state.activeWorkspaceId,
      agents: state.agents
    })
  }, [state.workspaces, state.activeWorkspaceId, state.agents])

  // Schedule only the next lifecycle boundary. This keeps provider records
  // self-healing without waking and dispatching every second when nothing is due.
  useEffect(() => {
    const deadline = agentLifecycleDeadline
    if (deadline === null) return
    const timer = window.setTimeout(
      () => dispatch({ type: 'expireAgents', now: Math.max(Date.now(), deadline) }),
      Math.max(0, deadline - Date.now())
    )
    return () => window.clearTimeout(timer)
  }, [agentLifecycleDeadline])

  // A shell can exit while its surface remains open. Remove every agent bound to
  // that terminal immediately instead of leaving a live-looking sidebar record.
  useEffect(() => {
    const onTerminalExit = (event: Event): void => {
      const detail = (event as CustomEvent<{ surfaceId?: unknown }>).detail
      if (typeof detail?.surfaceId === 'string' && detail.surfaceId) {
        dispatch({ type: 'clearAgentsForSurface', surfaceId: detail.surfaceId })
      }
    }
    window.addEventListener(RENDERER_EVENT.terminalExit, onTerminalExit)
    return () => window.removeEventListener(RENDERER_EVENT.terminalExit, onTerminalExit)
  }, [])

  // Apply incoming socket commands: set-status / log / notify, plus workspace
  // control (new-workspace / select / close). new-workspace has no target id, so
  // it's handled before the workspaceId guard.
  useEffect(() => {
    return window.api.socket.onCommand((cmd) => {
      const { method, workspaceId, params } = cmd
      // new-workspace has no target id — handle it before the guard.
      if (method === 'new-workspace') {
        dispatch(
          createWorkspaceAction(
            typeof params.name === 'string' ? params.name : undefined,
            typeof params.cwd === 'string' ? params.cwd : undefined
          )
        )
        return
      }
      if (!workspaceId) return
      if (method === 'workspace-metadata') {
        if (isWorkspaceMetadata(params.metadata)) {
          dispatch({ type: 'setWorkspaceMetadata', id: workspaceId, metadata: params.metadata })
        }
      } else if (method === 'set-status' || method === 'log') {
        const status = String(params.status ?? params.text ?? '')
        dispatch({ type: 'setStatus', id: workspaceId, status: status || null })
      } else if (method === 'notify') {
        const workspace = stateRef.current.workspaces.find((item) => item.id === workspaceId)
        if (!workspace) return
        const body = String(params.body ?? '')
        dispatch({ type: 'setStatus', id: workspaceId, status: body || 'needs your attention' })
        const createdAt =
          typeof params.createdAt === 'number' && Number.isFinite(params.createdAt)
            ? params.createdAt
            : Date.now()
        const requestedSurfaceId =
          typeof params.surfaceId === 'string' && params.surfaceId ? params.surfaceId : null
        const activeSurfaceId = activeTerminalSurfaceId(workspace.root, workspace.activePaneId)
        dispatch({
          type: 'receiveNotification',
          notification: {
            id: `notification:${createdAt}:${++notificationSequence.current}`,
            workspaceId,
            surfaceId: requestedSurfaceId ?? activeSurfaceId ?? null,
            subjectId: null,
            title: String(params.title ?? 'Shepherd'),
            body: body || 'Needs your attention',
            source: params.notificationSource === 'osc' ? 'osc' : 'socket',
            severity: 'attention',
            createdAt
          }
        })
      } else if (method === 'report-usage') {
        const report = params.report
        if (report && typeof report === 'object') {
          dispatch({ type: 'reportUsage', id: workspaceId, report: report as UsageReport })
        }
      } else if (method === 'agent-report') {
        const report = params.report
        if (report && typeof report === 'object') {
          dispatch({ type: 'reportAgent', report: report as AgentReport })
        }
      } else if (method === 'agent-clear') {
        const agentId = typeof params.agentId === 'string' ? params.agentId : ''
        const source = typeof params.source === 'string' ? params.source : undefined
        if (agentId) dispatch({ type: 'clearAgent', id: agentId, source })
      } else if (method === 'focus-agent') {
        const agentId = typeof params.agentId === 'string' ? params.agentId : ''
        if (agentId) dispatch({ type: 'focusAgent', id: agentId })
      } else if (method === 'select-workspace') {
        dispatch({ type: 'selectWorkspace', id: workspaceId })
      } else if (method === 'rename-workspace') {
        dispatch({ type: 'renameWorkspace', id: workspaceId, name: String(params.name ?? '') })
      } else if (method === 'close-workspace') {
        dispatch({ type: 'closeWorkspace', id: workspaceId })
      } else if (method === 'new-split' || method === 'send-text' || method === 'send-key') {
        // These target the active pane/surface of the workspace — read CURRENT
        // state via the ref (the handler was installed once).
        const ws = stateRef.current.workspaces.find((w) => w.id === workspaceId)
        if (!ws) return
        if (method === 'new-split') {
          const raw = String(params.direction ?? params.text ?? 'right')
          const dir = raw === 'up' || raw === 'down' ? 'column' : 'row'
          dispatch(paneAction(ws.id, splitAction(ws.activePaneId, dir)))
        } else {
          const surfaceId = activeTerminalSurfaceId(ws.root, ws.activePaneId)
          if (!surfaceId) return
          if (method === 'send-text') {
            window.api.terminal.input({ id: surfaceId, data: String(params.text ?? '') })
          } else {
            // case-insensitive key names (Enter == enter)
            const seq =
              KEY_SEQ[
                String(params.key ?? params.text ?? '')
                  .toLowerCase()
                  .trim()
              ]
            if (seq) window.api.terminal.input({ id: surfaceId, data: seq })
          }
        }
      }
    })
  }, [])

  // Persist the active layout plus its bounded inbox. JSON equality keeps status,
  // usage, live-agent, and pulse churn from restarting the save debounce because
  // those fields are intentionally absent from the snapshot.
  const sessionJson = useMemo(() => JSON.stringify(toLayoutSnapshot(state)), [state])
  useEffect(() => {
    const t = setTimeout(() => window.api.session.save(JSON.parse(sessionJson)), 500)
    return () => clearTimeout(t)
  }, [sessionJson])

  // Drag the sidebar's right edge to resize it (pixel-based; same idea as the
  // pane Divider, textbook/10).
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    const onMove = (ev: MouseEvent): void => {
      setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startW + (ev.clientX - startX))))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.classList.add('resizing')
  }

  const blockedAgents = state.agents.filter((agent) => agent.state === 'blocked').length
  const unreadNotifications = state.notifications.filter(
    (notification) => notification.unread && !notification.resolved
  ).length
  const collapsedSidebarLabel = `Show sidebar (Ctrl+Shift+B)${
    state.agents.length > 0
      ? ` · ${state.agents.length} agent${state.agents.length === 1 ? '' : 's'}, ${blockedAgents} blocked`
      : ''
  }${unreadNotifications > 0 ? ` · ${unreadNotifications} unread notification${unreadNotifications === 1 ? '' : 's'}` : ''}`

  const openInspector = (workspaceId: string): void => {
    setUtilityOverlay(null)
    setInspectorWorkspaceId(workspaceId)
  }

  const openWorkspacePreview = (workspaceId: string, url: string): void => {
    const workspace = stateRef.current.workspaces.find((candidate) => candidate.id === workspaceId)
    if (!workspace) return
    const terminalId = activeTerminalSurfaceId(workspace.root, workspace.activePaneId)
    const terminalPane = terminalId ? findPaneBySurfaceId(workspace.root, terminalId) : null
    if (!terminalPane) return
    dispatch({ type: 'selectWorkspace', id: workspace.id })
    dispatch(paneAction(workspace.id, previewSplitAction(terminalPane.id, url)))
    setUtilityOverlay(null)
    setInspectorWorkspaceId(null)
  }

  const focusWorkspaceAgent = (agent: AgentRecord): void => {
    dispatch({ type: 'focusAgent', id: agent.agentId })
    setInspectorWorkspaceId(null)
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent(RENDERER_EVENT.focusSurface, {
          detail: agent.surfaceId
        })
      )
    })
  }

  const openPullRequest = (workspaceId: string, url: string): void => {
    const workspace = stateRef.current.workspaces.find((candidate) => candidate.id === workspaceId)
    if (!workspace) return
    const surfaceId = activeTerminalSurfaceId(workspace.root, workspace.activePaneId)
    if (!surfaceId) return
    void window.api.terminal
      .openLink({ id: surfaceId, target: { kind: 'url', url } })
      .then(
        (result) => {
          if (!result.ok) console.warn(`[shepherd:inspector] pull request open failed: ${result.error}`)
        },
        () => console.warn('[shepherd:inspector] pull request open request failed')
      )
  }

  const inspectedWorkspaceIndex = state.workspaces.findIndex(
    (workspace) => workspace.id === inspectorWorkspaceId
  )
  const inspectedWorkspace =
    inspectedWorkspaceIndex >= 0 ? state.workspaces[inspectedWorkspaceIndex] : null

  return (
    <div className="app">
      {collapsed ? (
        <button
          className="sidebar-expand"
          title={collapsedSidebarLabel}
          aria-label={collapsedSidebarLabel}
          onClick={() => setCollapsed(false)}
        >
          ›
        </button>
      ) : (
        <>
          <aside className="sidebar" style={{ width: sidebarWidth, flexBasis: sidebarWidth }}>
            <Sidebar
              workspaces={state.workspaces}
              agents={state.agents}
              notifications={state.notifications}
              activeWorkspaceId={state.activeWorkspaceId}
              dispatch={dispatch}
              onCollapse={() => setCollapsed(true)}
              onOpenPalette={() => {
                setInspectorWorkspaceId(null)
                setUtilityOverlay('palette')
              }}
              onInspectWorkspace={openInspector}
            />
          </aside>
          <div className="sidebar-resizer" onMouseDown={startResize} />
        </>
      )}

      <main className="workarea">
        {state.workspaces.map((w, position) => (
          <WorkspaceView
            key={w.id}
            workspace={w}
            position={position}
            active={w.id === state.activeWorkspaceId}
            dispatch={dispatch}
            onInspect={openInspector}
          />
        ))}
      </main>
      {utilityOverlay === 'palette' && (
        <CommandPalette
          context={commandContext(state, collapsed)}
          onExecute={(id) => executeCommandRef.current(id)}
          onClose={() => setUtilityOverlay(null)}
        />
      )}
      {utilityOverlay === 'help' && (
        <ShortcutHelp
          context={commandContext(state, collapsed)}
          onOpenPalette={() => setUtilityOverlay('palette')}
          onClose={() => setUtilityOverlay(null)}
        />
      )}
      {utilityOverlay === 'settings' && (
        <SettingsDialog
          onOpenHelp={() => setUtilityOverlay('help')}
          onClose={() => setUtilityOverlay(null)}
        />
      )}
      {utilityOverlay === 'preview' && (
        <PreviewPicker
          ports={
            state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)?.ports ??
            []
          }
          onOpen={(url) => {
            openWorkspacePreview(stateRef.current.activeWorkspaceId, url)
          }}
          onClose={() => setUtilityOverlay(null)}
        />
      )}
      {inspectedWorkspace && (
        <WorkspaceInspector
          workspace={inspectedWorkspace}
          position={inspectedWorkspaceIndex}
          agents={state.agents.filter((agent) => agent.workspaceId === inspectedWorkspace.id)}
          onOpenPreview={(url) => openWorkspacePreview(inspectedWorkspace.id, url)}
          onOpenPullRequest={(url) => openPullRequest(inspectedWorkspace.id, url)}
          onFocusAgent={focusWorkspaceAgent}
          onClose={() => setInspectorWorkspaceId(null)}
        />
      )}
    </div>
  )
}
