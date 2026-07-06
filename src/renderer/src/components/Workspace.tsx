import { useEffect, useMemo, useReducer, useRef } from 'react'
import { computeLayout, findPane } from '../layout/tree'
import { workspaceReducer, initialWorkspace } from '../state/workspaceReducer'
import PaneView from './PaneView'
import Divider from './Divider'

// ─────────────────────────────────────────────────────────────────────────────
// Workspace — owns the layout state and renders the flat "pane layer": every pane
// absolutely positioned at its computed rectangle, plus the draggable dividers.
// Because panes live in ONE flat, keyed list (not a nested tree of components),
// splitting/closing never remounts unrelated terminals. See textbook/10.
// ─────────────────────────────────────────────────────────────────────────────

export default function Workspace(): React.JSX.Element {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, initialWorkspace)
  const layerRef = useRef<HTMLDivElement | null>(null)

  const { panes, dividers } = useMemo(() => computeLayout(state.root), [state.root])

  // Keyboard shortcuts. Ctrl+Shift+<key> is used so we never steal a terminal's
  // Ctrl keys (e.g. Ctrl+D = EOF). Capture phase → intercept before xterm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return
      const paneId = state.activePaneId
      switch (e.key.toLowerCase()) {
        case 'd':
          dispatch({ type: 'split', paneId, direction: 'row' })
          break
        case 'e':
          dispatch({ type: 'split', paneId, direction: 'column' })
          break
        case 't':
          dispatch({ type: 'newSurface', paneId })
          break
        case 'w': {
          const pane = findPane(state.root, paneId)
          if (pane) dispatch({ type: 'closeSurface', paneId, surfaceId: pane.activeSurfaceId })
          break
        }
        default:
          return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state.activePaneId, state.root])

  return (
    <div className="pane-layer" ref={layerRef}>
      {panes.map(({ pane, rect }) => (
        <PaneView
          key={pane.id}
          pane={pane}
          rect={rect}
          active={pane.id === state.activePaneId}
          dispatch={dispatch}
        />
      ))}
      {dividers.map((d) => (
        <Divider
          key={d.id}
          divider={d}
          layerRef={layerRef}
          onResize={(splitId, index, deltaFraction) =>
            dispatch({ type: 'resize', splitId, index, deltaFraction })
          }
        />
      ))}
    </div>
  )
}
