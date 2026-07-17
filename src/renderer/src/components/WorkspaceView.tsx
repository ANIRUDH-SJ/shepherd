import { useMemo, useRef, type Dispatch } from 'react'
import { computeLayout, listSurfaceIds } from '../layout/tree'
import { type AppAction, paneAction, type Workspace } from '../state/appReducer'
import type { WorkspaceAction } from '../state/workspaceReducer'
import PaneView from './PaneView'
import Divider from './Divider'

// ─────────────────────────────────────────────────────────────────────────────
// WorkspaceView — the pane layer for ONE workspace (the M2 tiling, now controlled).
// All workspaces render at once; only the active one is shown (display:block), so
// switching workspaces keeps every workspace's shells ALIVE (like tabs, textbook/10).
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  workspace: Workspace
  active: boolean
  dispatch: Dispatch<AppAction>
}

export default function WorkspaceView({ workspace, active, dispatch }: Props): React.JSX.Element {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const { panes, dividers } = useMemo(() => computeLayout(workspace.root), [workspace.root])

  // Terminal labels are POSITIONAL: the k-th terminal (in tree order) is "Terminal k".
  // Recomputed on every change, so closing one renumbers the rest.
  const surfaceNumbers = useMemo(() => {
    const m = new Map<string, number>()
    listSurfaceIds(workspace.root).forEach((id, i) => m.set(id, i + 1))
    return m
  }, [workspace.root])

  // Adapt pane-level (M2) actions to the app reducer, tagged with this workspace.
  const paneDispatch: Dispatch<WorkspaceAction> = (a) => dispatch(paneAction(workspace.id, a))

  return (
    <div className="pane-layer" ref={layerRef} style={{ display: active ? 'block' : 'none' }}>
      {panes.map(({ pane, rect }) => (
        <PaneView
          key={pane.id}
          pane={pane}
          rect={rect}
          active={pane.id === workspace.activePaneId}
          workspaceActive={active}
          workspaceId={workspace.id}
          surfaceNumbers={surfaceNumbers}
          dispatch={paneDispatch}
        />
      ))}
      {dividers.map((d) => (
        <Divider
          key={d.id}
          divider={d}
          layerRef={layerRef}
          onResize={(splitId, index, deltaFraction) =>
            paneDispatch({ type: 'resize', splitId, index, deltaFraction })
          }
        />
      ))}
    </div>
  )
}
