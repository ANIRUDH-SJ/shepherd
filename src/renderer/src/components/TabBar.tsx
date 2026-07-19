import type { Pane } from '../layout/types'
import { tabNavigationTarget, terminalPanelId, terminalTabId } from '../terminalChrome'
import Icon from './Icon'

// The tab bar at the top of a pane: one tab per surface, a "+" to add a tab, and
// the pane's split/close controls on the right. See textbook/10.

interface Props {
  pane: Pane
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
    surfaceNumbers,
    onSelect,
    onCloseSurface,
    onNewSurface,
    onSplitRight,
    onSplitDown,
    onClosePane
  } = props
  const surfaceIds = pane.surfaces.map((surface) => surface.id)

  const navigateTabs = (event: React.KeyboardEvent, surfaceId: string): void => {
    const target = tabNavigationTarget(surfaceIds, surfaceId, event.key)
    if (!target) return
    event.preventDefault()
    onSelect(target)
    requestAnimationFrame(() => document.getElementById(terminalTabId(target))?.focus())
  }

  return (
    <div className="pane-tabs" role="tablist" aria-label="Terminal tabs">
      {pane.surfaces.map((s) => (
        <div key={s.id} className={'tab' + (s.id === pane.activeSurfaceId ? ' active' : '')}>
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
            title={`Close Terminal ${surfaceNumbers.get(s.id) ?? '?'}`}
            aria-label={`Close Terminal ${surfaceNumbers.get(s.id) ?? '?'}`}
            onMouseDown={stop}
            onClick={() => onCloseSurface(s.id)}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}

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

      <button
        className="pane-btn"
        title="Split right (Ctrl+Shift+D)"
        onMouseDown={stop}
        onClick={onSplitRight}
      >
        ▐
      </button>
      <button
        className="pane-btn"
        title="Split down (Ctrl+Shift+E)"
        onMouseDown={stop}
        onClick={onSplitDown}
      >
        ▄
      </button>
      <button
        className="pane-btn"
        title="Close pane (Ctrl+Shift+W)"
        onMouseDown={stop}
        onClick={onClosePane}
      >
        ×
      </button>
    </div>
  )
}
