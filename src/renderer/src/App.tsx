import { useEffect, useReducer, useRef, useState } from 'react'
import { appReducer, initialApp, createWorkspaceAction, paneAction } from './state/appReducer'
import { splitAction, newSurfaceAction } from './state/workspaceReducer'
import { findPane } from './layout/tree'
import Sidebar from './components/Sidebar'
import WorkspaceView from './components/WorkspaceView'

// Computed once at module load (StrictMode double-invokes lazy initializers).
const INITIAL_APP = initialApp()

const MIN_SIDEBAR = 170
const MAX_SIDEBAR = 420
const DEFAULT_SIDEBAR = 240

// The app shell: owns the whole AppState, renders the sidebar + the stack of
// workspace views (only the active one visible), and the global keyboard map.
export default function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(appReducer, INITIAL_APP)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR)
  const [collapsed, setCollapsed] = useState(false)

  // Keep the latest state in a ref so the (once-installed) key handler sees it.
  const stateRef = useRef(state)
  stateRef.current = state

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
          if (pane) dispatch(paneAction(ws.id, { type: 'closeSurface', paneId, surfaceId: pane.activeSurfaceId }))
          break
        }
        case 'n':
          dispatch(createWorkspaceAction())
          break
        case 'b':
          setCollapsed((c) => !c)
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
      workspaces: state.workspaces.map((w) => ({ id: w.id, name: w.name })),
      activeWorkspaceId: state.activeWorkspaceId
    })
  }, [state.workspaces, state.activeWorkspaceId])

  // Apply incoming socket commands (from `cmux set-status` / `notify` / `log`).
  useEffect(() => {
    return window.api.socket.onCommand((cmd) => {
      const { method, workspaceId, params } = cmd
      if (!workspaceId) return
      if (method === 'set-status' || method === 'log') {
        const status = String(params.status ?? params.text ?? '')
        dispatch({ type: 'setStatus', id: workspaceId, status: status || null })
      } else if (method === 'notify') {
        const body = String(params.body ?? '')
        dispatch({ type: 'setStatus', id: workspaceId, status: body || 'needs your attention' })
        dispatch({ type: 'setAttention', id: workspaceId, unread: true, attention: true })
      }
    })
  }, [])

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

  return (
    <div className="app">
      {collapsed ? (
        <button className="sidebar-expand" title="Show sidebar (Ctrl+Shift+B)" onClick={() => setCollapsed(false)}>
          ›
        </button>
      ) : (
        <>
          <aside className="sidebar" style={{ width: sidebarWidth, flexBasis: sidebarWidth }}>
            <Sidebar
              workspaces={state.workspaces}
              activeWorkspaceId={state.activeWorkspaceId}
              dispatch={dispatch}
              onCollapse={() => setCollapsed(true)}
            />
          </aside>
          <div className="sidebar-resizer" onMouseDown={startResize} />
        </>
      )}

      <main className="workarea">
        {state.workspaces.map((w) => (
          <WorkspaceView key={w.id} workspace={w} active={w.id === state.activeWorkspaceId} dispatch={dispatch} />
        ))}
      </main>
    </div>
  )
}
