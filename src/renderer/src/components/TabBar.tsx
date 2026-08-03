import { useEffect, useRef } from 'react'
import type { Pane, Surface } from '../layout/types'
import { surfaceLabel, surfacePanelId, surfaceTabId, tabNavigationTarget } from '../terminalChrome'
import Icon from './Icon'

// The tab bar at the top of a pane: one tab per surface, a "+" to add a tab, and
// the pane's split/close controls on the right. See textbook/10.

interface Props {
  pane: Pane
  paneNumber: number
  canClosePane: boolean
  terminalNumbers: Map<string, number>
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
    terminalNumbers,
    onSelect,
    onCloseSurface,
    onNewSurface,
    onSplitRight,
    onSplitDown,
    onClosePane
  } = props
  const surfaceIds = pane.surfaces.map((surface) => surface.id)
  const activeTabRef = useRef<HTMLDivElement | null>(null)

  const canCloseSurface = (surface: Surface): boolean =>
    (pane.surfaces.length > 1 || canClosePane) &&
    (surface.panel.type === 'preview' || terminalNumbers.size > 1)

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pane.activeSurfaceId])

  const handleTabKeyDown = (event: React.KeyboardEvent, surfaceId: string): void => {
    const surface = pane.surfaces.find((candidate) => candidate.id === surfaceId)
    if (event.key === 'Delete' && surface && canCloseSurface(surface)) {
      event.preventDefault()
      onCloseSurface(surfaceId)
      return
    }

    const target = tabNavigationTarget(surfaceIds, surfaceId, event.key)
    if (!target) return
    event.preventDefault()
    onSelect(target)
    requestAnimationFrame(() => document.getElementById(surfaceTabId(target))?.focus())
  }

  return (
    <div className="pane-tabs">
      <div className="tab-list" role="tablist" aria-label={`Pane ${paneNumber} tabs`}>
        {pane.surfaces.map((s) => {
          const label = surfaceLabel(s, terminalNumbers)
          const closeable = canCloseSurface(s)
          return (
            <div
              key={s.id}
              ref={s.id === pane.activeSurfaceId ? activeTabRef : undefined}
              role="presentation"
              className={'tab' + (s.id === pane.activeSurfaceId ? ' active' : '')}
            >
              <button
                type="button"
                id={surfaceTabId(s.id)}
                className="tab-select"
                role="tab"
                aria-selected={s.id === pane.activeSurfaceId}
                aria-controls={surfacePanelId(s.id)}
                aria-keyshortcuts={closeable ? 'Delete' : undefined}
                tabIndex={s.id === pane.activeSurfaceId ? 0 : -1}
                title={`${label}${closeable ? ' (Delete to close)' : ''}`}
                onMouseDown={stop}
                onClick={() => onSelect(s.id)}
                onKeyDown={(event) => handleTabKeyDown(event, s.id)}
              >
                {s.panel.type === 'preview' && <Icon name="preview" />}
                <span className="tab-title">{label}</span>
              </button>
              <button
                type="button"
                className="tab-close"
                title={closeable ? `Close ${label}` : 'The last tab cannot be closed'}
                aria-label={`Close ${label}`}
                tabIndex={-1}
                disabled={!closeable}
                onMouseDown={stop}
                onClick={() => onCloseSurface(s.id)}
              >
                <Icon name="close" />
              </button>
            </div>
          )
        })}
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
          title={canClosePane ? 'Close pane' : 'A workspace must keep at least one terminal pane'}
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
