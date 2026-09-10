import type { Dispatch } from 'react'
import type { Pane, Rect } from '../layout/types'
import {
  type WorkspaceAction,
  splitAction,
  newSurfaceAction,
  updatePreviewUrlAction
} from '../state/workspaceReducer'
import TabBar from './TabBar'
import TerminalHost from './TerminalHost'
import PreviewHost from './PreviewHost'

// ─────────────────────────────────────────────────────────────────────────────
// PaneView — one leaf pane, absolutely positioned at its computed % rectangle.
// Contains a tab bar plus every surface's TerminalHost (only the active one is
// shown). Keyed by pane.id in the flat layer, so it survives tree restructuring.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  pane: Pane
  paneNumber: number
  canClosePane: boolean
  rect: Rect
  active: boolean
  attentionPulse: number
  workspaceActive: boolean
  workspaceId: string
  cwd: string
  showWelcome: boolean
  terminalNumbers: Map<string, number>
  dispatch: Dispatch<WorkspaceAction>
}

export default function PaneView({
  pane,
  paneNumber,
  canClosePane,
  rect,
  active,
  attentionPulse,
  workspaceActive,
  workspaceId,
  cwd,
  showWelcome,
  terminalNumbers,
  dispatch
}: Props): React.JSX.Element {
  return (
    <div
      className={'pane' + (active ? ' active' : '')}
      role="group"
      aria-label={`Pane ${paneNumber}${active ? ', active' : ''}`}
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
        paneNumber={paneNumber}
        canClosePane={canClosePane}
        terminalNumbers={terminalNumbers}
        onSelect={(surfaceId) => dispatch({ type: 'setActiveSurface', paneId: pane.id, surfaceId })}
        onCloseSurface={(surfaceId) =>
          dispatch({ type: 'closeSurface', paneId: pane.id, surfaceId })
        }
        onNewSurface={() => dispatch(newSurfaceAction(pane.id))}
        onSplitRight={() => dispatch(splitAction(pane.id, 'row'))}
        onSplitDown={() => dispatch(splitAction(pane.id, 'column'))}
        onClosePane={() => dispatch({ type: 'closePane', paneId: pane.id })}
      />

      <div className="pane-body">
        {pane.surfaces.map((surface) =>
          surface.panel.type === 'terminal' ? (
            <TerminalHost
              key={surface.id}
              surfaceId={surface.id}
              workspaceId={workspaceId}
              cwd={cwd}
              active={surface.id === pane.activeSurfaceId}
              focused={workspaceActive && active && surface.id === pane.activeSurfaceId}
              showWelcome={showWelcome && surface.id === pane.activeSurfaceId}
            />
          ) : (
            <PreviewHost
              key={surface.id}
              surfaceId={surface.id}
              url={surface.panel.url}
              active={surface.id === pane.activeSurfaceId}
              onUrlChange={(url) => {
                const action = updatePreviewUrlAction(surface.id, url)
                if (action) dispatch(action)
              }}
            />
          )
        )}
      </div>
      {attentionPulse > 0 && (
        <div
          key={`attention-${attentionPulse}`}
          className="pane-attention-ring"
          aria-hidden="true"
        />
      )}
    </div>
  )
}
