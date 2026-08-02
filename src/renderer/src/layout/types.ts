// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT MODEL  (one workspace's panes — the M2 subset of the object model)
// Full model: Window → Workspace → Pane → Surface → Panel (FEATURES.md Part 1).
// M2 covers Pane / Surface / the split tree. Multi-workspace arrives in M3.
// See textbook/09 (data model) and textbook/10 (tiling).
// ─────────────────────────────────────────────────────────────────────────────

export interface TerminalPanel {
  type: 'terminal'
}

export interface PreviewPanel {
  type: 'preview'
  url: string
}

export type Panel = TerminalPanel | PreviewPanel

/** A tab within a pane. Terminal surface ids also identify their PTYs; preview
 *  surfaces own an isolated web guest instead. */
export interface Surface {
  id: string
  panel: Panel
}

/** A leaf region: holds one or more surfaces (tabs), one of them active. */
export interface Pane {
  id: string
  surfaces: Surface[]
  activeSurfaceId: string
}

/**
 * The layout is a tree. Leaves are panes; internal nodes are splits.
 * `row`  = children laid out left→right (a vertical divider between them).
 * `column` = children laid out top→bottom (a horizontal divider between them).
 * `sizes` are fractions per child and always sum to 1.
 */
export type LayoutNode =
  | { type: 'pane'; pane: Pane }
  | {
      type: 'split'
      id: string
      direction: 'row' | 'column'
      sizes: number[]
      children: LayoutNode[]
    }

/** A rectangle in PERCENT of the layer (0–100). Used to absolutely-position panes. */
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** A pane placed at a computed rectangle. */
export interface PlacedPane {
  pane: Pane
  rect: Rect
}

/** A draggable boundary between two children of a split, placed for rendering. */
export interface PlacedDivider {
  id: string
  splitId: string
  index: number // boundary between child `index` and `index + 1`
  direction: 'row' | 'column'
  leftPct: number
  topPct: number
  lengthPct: number // length of the bar along its cross-axis, in %
  splitExtentPct: number // the split's size along the DRAG axis, in % (for px→fraction)
}
