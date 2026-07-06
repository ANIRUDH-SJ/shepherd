import type { RefObject } from 'react'
import type { PlacedDivider } from '../layout/types'

// ─────────────────────────────────────────────────────────────────────────────
// Divider — a draggable boundary between two children of a split.
// On drag we convert pixel movement into a fraction of the split's extent and
// dispatch incremental resize deltas. See textbook/10 §resizing.
// (This same drag-handle logic is reused for the sidebar width in M3.)
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  divider: PlacedDivider
  layerRef: RefObject<HTMLDivElement | null>
  onResize: (splitId: string, index: number, deltaFraction: number) => void
}

export default function Divider({ divider, layerRef, onResize }: Props): React.JSX.Element {
  const isRow = divider.direction === 'row' // vertical bar → horizontal drag

  const onMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const layer = layerRef.current
    if (!layer) return

    const layerRect = layer.getBoundingClientRect()
    const axisPx = isRow ? layerRect.width : layerRect.height
    // The split's length along the drag axis, in pixels — fixed for this drag.
    const splitPx = (divider.splitExtentPct / 100) * axisPx
    if (splitPx <= 0) return

    let lastPx = isRow ? e.clientX : e.clientY

    const onMove = (ev: MouseEvent): void => {
      const cur = isRow ? ev.clientX : ev.clientY
      const deltaPx = cur - lastPx
      lastPx = cur
      onResize(divider.splitId, divider.index, deltaPx / splitPx)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.classList.add('resizing')
  }

  const style: React.CSSProperties = isRow
    ? { left: `${divider.leftPct}%`, top: `${divider.topPct}%`, height: `${divider.lengthPct}%` }
    : { left: `${divider.leftPct}%`, top: `${divider.topPct}%`, width: `${divider.lengthPct}%` }

  return <div className={`divider ${divider.direction}`} style={style} onMouseDown={onMouseDown} />
}
