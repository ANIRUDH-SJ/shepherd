import { useMemo, useRef, type Dispatch } from 'react'
import { computeLayout, listSurfaceIds } from '../layout/tree'
import { type AppAction, paneAction, type Workspace } from '../state/appReducer'
import { workspaceIdentity } from '../sidebarView'
import type { WorkspaceAction } from '../state/workspaceReducer'
import { terminalContextSummary } from '../terminalChrome'
import PaneView from './PaneView'
import Divider from './Divider'
import Icon from './Icon'

// ─────────────────────────────────────────────────────────────────────────────
// WorkspaceView — the pane layer for ONE workspace (the M2 tiling, now controlled).
// All workspaces render at once; only the active one is shown (display:block), so
// switching workspaces keeps every workspace's shells ALIVE (like tabs, textbook/10).
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  workspace: Workspace
  position: number
  active: boolean
  dispatch: Dispatch<AppAction>
}

export default function WorkspaceView({
  workspace,
  position,
  active,
  dispatch
}: Props): React.JSX.Element {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const { panes, dividers } = useMemo(() => computeLayout(workspace.root), [workspace.root])

  // Terminal labels are POSITIONAL: the k-th terminal (in tree order) is "Terminal k".
  // Recomputed on every change, so closing one renumbers the rest.
  const surfaceNumbers = useMemo(() => {
    const m = new Map<string, number>()
    listSurfaceIds(workspace.root).forEach((id, i) => m.set(id, i + 1))
    return m
  }, [workspace.root])

  const identity = workspaceIdentity(workspace, position)
  const chromeSummary = terminalContextSummary(
    panes.map((entry) => entry.pane),
    workspace.activePaneId,
    surfaceNumbers
  )

  // Adapt pane-level (M2) actions to the app reducer, tagged with this workspace.
  const paneDispatch: Dispatch<WorkspaceAction> = (a) => dispatch(paneAction(workspace.id, a))

  return (
    <div className="workspace-view" style={{ display: active ? 'flex' : 'none' }}>
      <header className="workspace-context-strip" aria-label="Workspace context">
        <div
          className="workspace-context-identity"
          title={`${identity.primary}\n${identity.context}\n${workspace.cwd}`}
        >
          <Icon name="terminal" />
          <strong>{identity.primary}</strong>
          <span>{identity.context}</span>
        </div>
        <span className="workspace-context-separator" aria-hidden="true" />
        <div
          className={'workspace-context-branch' + (workspace.gitBranch ? '' : ' no-git')}
          title={
            workspace.gitBranch ? `Git branch: ${workspace.gitBranch}` : 'Not a Git repository'
          }
        >
          <Icon name="branch" />
          <span>{workspace.gitBranch ?? 'No Git'}</span>
        </div>
        <div className="workspace-context-spacer" />
        <span className="workspace-context-focus" title={chromeSummary.countLabel}>
          {chromeSummary.focusLabel}
        </span>
      </header>
      <div className="pane-layer" ref={layerRef}>
        {panes.map(({ pane, rect }, paneIndex) => (
          <PaneView
            key={pane.id}
            pane={pane}
            paneNumber={paneIndex + 1}
            canClosePane={panes.length > 1}
            rect={rect}
            active={pane.id === workspace.activePaneId}
            workspaceActive={active}
            workspaceId={workspace.id}
            workspaceCwd={workspace.cwd}
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
    </div>
  )
}
