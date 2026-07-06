import type { Pane } from '../layout/types'

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
  const { pane, surfaceNumbers, onSelect, onCloseSurface, onNewSurface, onSplitRight, onSplitDown, onClosePane } = props
  return (
    <div className="pane-tabs">
      {pane.surfaces.map((s) => (
        <div
          key={s.id}
          className={'tab' + (s.id === pane.activeSurfaceId ? ' active' : '')}
          onMouseDown={(e) => {
            stop(e)
            onSelect(s.id)
          }}
        >
          <span className="tab-title">Terminal {surfaceNumbers.get(s.id) ?? '?'}</span>
          <button
            className="tab-close"
            title="Close tab"
            onMouseDown={(e) => {
              stop(e)
              onCloseSurface(s.id)
            }}
          >
            ×
          </button>
        </div>
      ))}

      <button className="tab-new" title="New tab (Ctrl+Shift+T)" onMouseDown={(e) => { stop(e); onNewSurface() }}>
        +
      </button>

      <div className="tabs-spacer" />

      <button className="pane-btn" title="Split right (Ctrl+Shift+D)" onMouseDown={(e) => { stop(e); onSplitRight() }}>
        ▐
      </button>
      <button className="pane-btn" title="Split down (Ctrl+Shift+E)" onMouseDown={(e) => { stop(e); onSplitDown() }}>
        ▄
      </button>
      <button className="pane-btn" title="Close pane (Ctrl+Shift+W)" onMouseDown={(e) => { stop(e); onClosePane() }}>
        ×
      </button>
    </div>
  )
}
