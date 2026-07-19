import type { Pane } from '../layout/types'
import { tabNavigationTarget, terminalPanelId, terminalTabId } from '../terminalChrome'
import Icon from './Icon'

// The tab bar at the top of a pane: one tab per surface, a "+" to add a tab, and
// the pane's split/close controls on the right. See textbook/10.

interface Props {
  pane: Pane
  paneNumber: number
  canClosePane: boolean
  surfaceNumbers: Map<string, number>
  onSelect: (surfaceId: string) => void
  onCloseSurface: (surfaceId: string) => void
  onNewSurface: () => void
  onSplitRight: () => void
  onSplitDown: () => void
  onClosePane: () => void
}

// Prevent a control's mousedown from starting text selection / reaching xterm,
// while still letting the pane's focus handler run.
function stop(e: React.MouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
}

export default function TabBar(props: Props): React.JSX.Element {
  const {
    pane,
    paneNumber,
    canClosePane,
    surfaceNumbers,
    onSelect,
    onCloseSurface,
    onNewSurface,
    onSplitRight,
    onSplitDown,
    onClosePane
  } = props
  const surfaceIds = pane.surfaces.map((surface) => surface.id)
  const canCloseSurface = pane.surfaces.length > 1 || canClosePane

  const navigateTabs = (event: React.KeyboardEvent, surfaceId: string): void => {
    const target = tabNavigationTarget(surfaceIds, surfaceId, event.key)
    if (!target) return
    event.preventDefault()
    onSelect(target)
    requestAnimationFrame(() => document.getElementById(terminalTabId(target))?.focus())
  }

  return (
    <div className="pane-tabs">
      <div className="tab-list" role="tablist" aria-label={`Pane ${paneNumber} terminal tabs`}>
        {pane.surfaces.map((s) => (
          <div
            key={s.id}
            role="presentation"
            className={'tab' + (s.id === pane.activeSurfaceId ? ' active' : '')}
          >
            <button
              type="button"
              id={terminalTabId(s.id)}
              className="tab-select"
              role="tab"
              aria-selected={s.id === pane.activeSurfaceId}
              aria-controls={terminalPanelId(s.id)}
              tabIndex={s.id === pane.activeSurfaceId ? 0 : -1}
              title={`Terminal ${surfaceNumbers.get(s.id) ?? '?'}`}
              onMouseDown={stop}
              onClick={() => onSelect(s.id)}
              onKeyDown={(event) => navigateTabs(event, s.id)}
            >
              <span className="tab-title">Terminal {surfaceNumbers.get(s.id) ?? '?'}</span>
            </button>
            <button
              type="button"
              className="tab-close"
              title={
                canCloseSurface
                  ? `Close Terminal ${surfaceNumbers.get(s.id) ?? '?'}`
                  : 'The last terminal cannot be closed'
              }
              aria-label={`Close Terminal ${surfaceNumbers.get(s.id) ?? '?'}`}
              disabled={!canCloseSurface}
              onMouseDown={stop}
              onClick={() => onCloseSurface(s.id)}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="tab-new"
        title="New tab (Ctrl+Shift+T)"
        aria-label="New terminal tab"
        onMouseDown={stop}
        onClick={onNewSurface}
      >
        <Icon name="add" />
      </button>

      <div className="tabs-spacer" />

      <div className="pane-actions" role="group" aria-label={`Pane ${paneNumber} actions`}>
        <button
          type="button"
          className="pane-btn"
          title="Split right (Ctrl+Shift+D)"
          aria-label={`Split Pane ${paneNumber} right`}
          onMouseDown={stop}
          onClick={onSplitRight}
        >
          <Icon name="split-right" />
        </button>
        <button
          type="button"
          className="pane-btn"
          title="Split down (Ctrl+Shift+E)"
          aria-label={`Split Pane ${paneNumber} down`}
          onMouseDown={stop}
          onClick={onSplitDown}
        >
          <Icon name="split-down" />
        </button>
        <button
          type="button"
          className="pane-btn"
          title={canClosePane ? 'Close pane (Ctrl+Shift+W)' : 'The last pane cannot be closed'}
          aria-label={`Close Pane ${paneNumber}`}
          disabled={!canClosePane}
          onMouseDown={stop}
          onClick={onClosePane}
        >
          <Icon name="close" />
        </button>
      </div>
    </div>
  )
}
