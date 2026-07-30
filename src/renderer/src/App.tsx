import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  appReducer,
  initialApp,
  sanitizeRestored,
  toLayoutSnapshot,
  createWorkspaceAction,
  paneAction
} from './state/appReducer'
import { splitAction, newSurfaceAction } from './state/workspaceReducer'
import { findPane } from './layout/tree'
import { bumpFontSize, resetFontSize } from './settings'
import type { AgentReport } from '../../shared/agent'
import type { UsageReport } from '../../shared/usage'
import { isWorkspaceMetadata } from '../../shared/workspaceMetadata'
import { nextAgentLifecycleDeadline } from './agentTiming'
import Sidebar from './components/Sidebar'
import WorkspaceView from './components/WorkspaceView'

// Restore the saved session synchronously at startup, else start fresh. Computed
// once at module load. Optional chaining keeps it safe if the bridge isn't ready.
const INITIAL_APP = sanitizeRestored(window.api?.session?.loadSync?.() ?? null) ?? initialApp()

const MIN_SIDEBAR = 170
const MAX_SIDEBAR = 420
const DEFAULT_SIDEBAR = 240

// Key name → terminal escape sequence, for `cmux send-key`.
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

  // Keep the latest state in a ref so the (once-installed) key handler sees it.
  const stateRef = useRef(state)
  stateRef.current = state
  const agentLifecycleDeadline = useMemo(
    () => nextAgentLifecycleDeadline(state.agents),
    [state.agents]
  )

  // Global keyboard shortcuts. Ctrl+Shift so we never steal a terminal's Ctrl keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return
      const s = stateRef.current
      const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
      if (!ws) return
      const paneId = ws.activePaneId
      switch (e.key.toLowerCase()) {
        case 'd':
          dispatch(paneAction(ws.id, splitAction(paneId, 'row')))
          break
        case 'e':
          dispatch(paneAction(ws.id, splitAction(paneId, 'column')))
          break
        case 't':
          dispatch(paneAction(ws.id, newSurfaceAction(paneId)))
          break
        case 'w': {
          const pane = findPane(ws.root, paneId)
          if (pane)
            dispatch(
              paneAction(ws.id, { type: 'closeSurface', paneId, surfaceId: pane.activeSurfaceId })
            )
          break
        }
        case 'n':
          dispatch(createWorkspaceAction())
          break
        case 'b':
          setCollapsed((c) => !c)
          break
        case '+':
        case '=':
          bumpFontSize(1)
          break
        case '_':
        case '-':
          bumpFontSize(-1)
          break
        case ')':
        case '0':
          resetFontSize()
          break
        default:
          return
      }
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
        activeSurfaceId: findPane(w.root, w.activePaneId)?.activeSurfaceId
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
    window.addEventListener('cmux:terminal-exit', onTerminalExit)
    return () => window.removeEventListener('cmux:terminal-exit', onTerminalExit)
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
        const body = String(params.body ?? '')
        dispatch({ type: 'setStatus', id: workspaceId, status: body || 'needs your attention' })
        dispatch({ type: 'setAttention', id: workspaceId, unread: true, attention: true })
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
          const pane = findPane(ws.root, ws.activePaneId)
          const surfaceId = pane ? pane.activeSurfaceId : null
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

  // Persist only the LAYOUT (not transient status/attention), and only when it
  // actually changes — so agent status churn can't starve a layout save, and we
  // don't save fields we throw away on restore. (Copilot review, PR #4)
  const layoutJson = useMemo(() => JSON.stringify(toLayoutSnapshot(state)), [state])
  useEffect(() => {
    const t = setTimeout(() => window.api.session.save(JSON.parse(layoutJson)), 500)
    return () => clearTimeout(t)
  }, [layoutJson])

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
  const collapsedSidebarLabel = `Show sidebar (Ctrl+Shift+B)${
    state.agents.length > 0
      ? ` · ${state.agents.length} agent${state.agents.length === 1 ? '' : 's'}, ${blockedAgents} blocked`
      : ''
  }`

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
              activeWorkspaceId={state.activeWorkspaceId}
              dispatch={dispatch}
              onCollapse={() => setCollapsed(true)}
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
          />
        ))}
      </main>
    </div>
  )
}
