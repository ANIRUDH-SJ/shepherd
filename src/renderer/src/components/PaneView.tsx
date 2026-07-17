import type { Dispatch } from 'react'
import type { Pane, Rect } from '../layout/types'
import { type WorkspaceAction, splitAction, newSurfaceAction } from '../state/workspaceReducer'
import TabBar from './TabBar'
import TerminalHost from './TerminalHost'

// ─────────────────────────────────────────────────────────────────────────────
// PaneView — one leaf pane, absolutely positioned at its computed % rectangle.
// Contains a tab bar plus every surface's TerminalHost (only the active one is
// shown). Keyed by pane.id in the flat layer, so it survives tree restructuring.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  pane: Pane
  rect: Rect
  active: boolean
  workspaceActive: boolean
  workspaceId: string
  surfaceNumbers: Map<string, number>
  dispatch: Dispatch<WorkspaceAction>
}

export default function PaneView({
  pane,
  rect,
  active,
  workspaceActive,
  workspaceId,
  surfaceNumbers,
  dispatch
}: Props): React.JSX.Element {
  return (
    <div
      className={'pane' + (active ? ' active' : '')}
      style={{
        left: `${rect.left}%`,
        top: `${rect.top}%`,
        width: `${rect.width}%`,
        height: `${rect.height}%`
      }}
      // Capture so focusing works even if xterm stops propagation on mousedown.
      onMouseDownCapture={() => dispatch({ type: 'setActivePane', paneId: pane.id })}
    >
      <TabBar
        pane={pane}
        surfaceNumbers={surfaceNumbers}
        onSelect={(surfaceId) => dispatch({ type: 'setActiveSurface', paneId: pane.id, surfaceId })}
        onCloseSurface={(surfaceId) => dispatch({ type: 'closeSurface', paneId: pane.id, surfaceId })}
        onNewSurface={() => dispatch(newSurfaceAction(pane.id))}
        onSplitRight={() => dispatch(splitAction(pane.id, 'row'))}
        onSplitDown={() => dispatch(splitAction(pane.id, 'column'))}
        onClosePane={() => dispatch({ type: 'closePane', paneId: pane.id })}
      />

      <div className="pane-body">
        {pane.surfaces.map((s) => (
          <TerminalHost
            key={s.id}
            surfaceId={s.id}
            workspaceId={workspaceId}
            active={s.id === pane.activeSurfaceId}
            focused={workspaceActive && active && s.id === pane.activeSurfaceId}
          />
        ))}
      </div>
    </div>
  )
}
