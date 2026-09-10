import { useMemo, useRef, type Dispatch } from 'react'
import { computeLayout, listSurfaceIds, listTerminalSurfaceIds } from '../layout/tree'
import { type AppAction, paneAction, type Workspace } from '../state/appReducer'
import { workspaceIdentity } from '../sidebarView'
import type { WorkspaceAction } from '../state/workspaceReducer'
import { terminalWorkspaceAriaLabel } from '../terminalChrome'
import PaneView from './PaneView'
import Divider from './Divider'
import Icon from './Icon'

// ─────────────────────────────────────────────────────────────────────────────
// WorkspaceView — the pane layer for one workspace.
// All workspaces render at once; only the active one is shown (display:block), so
// switching workspaces keeps every workspace's shells alive like browser tabs.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  workspace: Workspace
  position: number
  active: boolean
  welcomeSurfaceId: string | null
  dispatch: Dispatch<AppAction>
  onInspect: (workspaceId: string) => void
}

export default function WorkspaceView({
  workspace,
  position,
  active,
  welcomeSurfaceId,
  dispatch,
  onInspect
}: Props): React.JSX.Element {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const { panes, dividers } = useMemo(() => computeLayout(workspace.root), [workspace.root])

  // Terminal labels are POSITIONAL: the k-th terminal (in tree order) is "Terminal k".
  // Recomputed on every change, so closing one renumbers the rest.
  const terminalNumbers = useMemo(() => {
    const m = new Map<string, number>()
    listTerminalSurfaceIds(workspace.root).forEach((id, i) => m.set(id, i + 1))
    return m
  }, [workspace.root])

  const identity = workspaceIdentity(workspace, position)
  const chromeLabel = terminalWorkspaceAriaLabel(
    identity.primary,
    panes.length,
    terminalNumbers.size,
    listSurfaceIds(workspace.root).length - terminalNumbers.size
  )

  // Adapt pane-level (M2) actions to the app reducer, tagged with this workspace.
  const paneDispatch: Dispatch<WorkspaceAction> = (a) => dispatch(paneAction(workspace.id, a))

  return (
    <div
      className="workspace-view"
      role="region"
      aria-label={chromeLabel}
      style={{ display: active ? 'flex' : 'none' }}
    >
      <header className="workspace-titlebar">
        <button
          type="button"
          title={`Inspect ${identity.primary}\n${workspace.cwd}`}
          aria-label={`Inspect ${identity.primary} workspace`}
          onClick={() => onInspect(workspace.id)}
        >
          <Icon name="folder" />
          <strong>{identity.primary}</strong>
        </button>
      </header>
      <div className="pane-layer" ref={layerRef}>
        {panes.map(({ pane, rect }, paneIndex) => (
          <PaneView
            key={pane.id}
            pane={pane}
            paneNumber={paneIndex + 1}
            canClosePane={
              panes.length > 1 &&
              pane.surfaces.filter((surface) => surface.panel.type === 'terminal').length <
                terminalNumbers.size
            }
            rect={rect}
            active={pane.id === workspace.activePaneId}
            attentionPulse={pane.id === workspace.activePaneId ? workspace.attentionPulse : 0}
            workspaceActive={active}
            workspaceId={workspace.id}
            cwd={workspace.cwd}
            showWelcome={pane.surfaces.some((surface) => surface.id === welcomeSurfaceId)}
            terminalNumbers={terminalNumbers}
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
