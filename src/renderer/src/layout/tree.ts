import type { LayoutNode, Pane, Surface, PlacedPane, PlacedDivider, Rect } from './types'
import { normalizePreviewUrl } from '../../../shared/preview'

// ─────────────────────────────────────────────────────────────────────────────
// PURE TREE + GEOMETRY OPERATIONS
// No React, no side effects — every function takes a tree and returns a NEW tree
// (immutable updates). This is the testable core of the tiling system.
// See textbook/10-tiling-and-layout.md.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_FRACTION = 0.1 // a pane can't be shrunk below 10% of its split

export function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function makeSurface(): Surface {
  // No stored number — the "Terminal N" label is derived from position at render
  // time (see WorkspaceView), so numbers renumber when others close.
  return { id: uid('term'), panel: { type: 'terminal' } }
}

export function makePreviewSurface(url: string): Surface {
  const normalized = normalizePreviewUrl(url)
  if (!normalized.ok || !normalized.url) throw new Error('Invalid localhost preview URL')
  return { id: uid('preview'), panel: { type: 'preview', url: normalized.url } }
}

export function makePane(surface: Surface): Pane {
  return { id: uid('pane'), surfaces: [surface], activeSurfaceId: surface.id }
}

/** A fresh tree: one pane with one terminal. */
export function initialTree(): { root: LayoutNode; activePaneId: string } {
  const pane = makePane(makeSurface())
  return { root: { type: 'pane', pane }, activePaneId: pane.id }
}

// ── queries ──────────────────────────────────────────────────────────────────

export function findPane(node: LayoutNode, paneId: string): Pane | null {
  if (node.type === 'pane') return node.pane.id === paneId ? node.pane : null
  for (const child of node.children) {
    const found = findPane(child, paneId)
    if (found) return found
  }
  return null
}

/** Find the pane that owns a terminal surface id. */
export function findPaneBySurfaceId(node: LayoutNode, surfaceId: string): Pane | null {
  if (node.type === 'pane') {
    return node.pane.surfaces.some((surface) => surface.id === surfaceId) ? node.pane : null
  }
  for (const child of node.children) {
    const pane = findPaneBySurfaceId(child, surfaceId)
    if (pane) return pane
  }
  return null
}

/** Every surface id in the tree (used to reconcile which terminals should exist). */
export function listSurfaceIds(node: LayoutNode): string[] {
  if (node.type === 'pane') return node.pane.surfaces.map((s) => s.id)
  return node.children.flatMap(listSurfaceIds)
}

export function listTerminalSurfaceIds(node: LayoutNode): string[] {
  if (node.type === 'pane') {
    return node.pane.surfaces
      .filter((surface) => surface.panel.type === 'terminal')
      .map((surface) => surface.id)
  }
  return node.children.flatMap(listTerminalSurfaceIds)
}

export function activeTerminalSurfaceId(node: LayoutNode, activePaneId: string): string | null {
  const pane = findPane(node, activePaneId)
  const active = pane?.surfaces.find((surface) => surface.id === pane.activeSurfaceId)
  if (active?.panel.type === 'terminal') return active.id
  return listTerminalSurfaceIds(node)[0] ?? null
}

// (Numbering is positional now — derived from listSurfaceIds order in the UI — so
//  the old title/lowest-free helpers were removed.)

/** The id of the first pane found (used to pick a new active pane after a close). */
export function firstPaneId(node: LayoutNode): string {
  return node.type === 'pane' ? node.pane.id : firstPaneId(node.children[0])
}

/** Deep-validate an untrusted value as a well-formed LayoutNode. Used to fail a
 *  session restore CLOSED (fall back to a fresh app) instead of crashing later in
 *  firstPaneId / computeLayout on a corrupt or old-format snapshot. */
export function isValidLayoutNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const n = node as Record<string, unknown>
  if (n.type === 'pane') {
    const pane = n.pane as Record<string, unknown> | undefined
    if (!pane || typeof pane.id !== 'string' || typeof pane.activeSurfaceId !== 'string')
      return false
    if (!Array.isArray(pane.surfaces) || pane.surfaces.length === 0) return false
    const ids = new Set<string>()
    const surfacesValid = pane.surfaces.every((value) => {
      if (!value || typeof value !== 'object') return false
      const surface = value as Record<string, unknown>
      if (typeof surface.id !== 'string' || !surface.id || ids.has(surface.id)) return false
      ids.add(surface.id)
      if (surface.panel === undefined) return true
      if (!surface.panel || typeof surface.panel !== 'object') return false
      const panel = surface.panel as Record<string, unknown>
      if (panel.type === 'terminal') return true
      return panel.type === 'preview' && normalizePreviewUrl(panel.url).ok
    })
    return surfacesValid && ids.has(pane.activeSurfaceId)
  }
  if (n.type === 'split') {
    if (typeof n.id !== 'string') return false
    if (n.direction !== 'row' && n.direction !== 'column') return false
    if (!Array.isArray(n.children) || n.children.length === 0) return false
    if (!Array.isArray(n.sizes) || n.sizes.length !== n.children.length) return false
    return n.children.every((c) => isValidLayoutNode(c))
  }
  return false
}

/** Validate and upgrade old terminal-only session trees to the panel model. */
export function normalizeLayoutNode(node: unknown): LayoutNode | null {
  if (!isValidLayoutNode(node)) return null
  const value = node as Record<string, unknown>
  if (value.type === 'pane') {
    const pane = value.pane as Record<string, unknown>
    const surfaces = (pane.surfaces as Array<Record<string, unknown>>).map((surface) => {
      const panel = surface.panel as Record<string, unknown> | undefined
      if (panel?.type === 'preview') {
        const normalized = normalizePreviewUrl(panel.url)
        return {
          id: surface.id as string,
          panel: { type: 'preview' as const, url: normalized.url! }
        }
      }
      return { id: surface.id as string, panel: { type: 'terminal' as const } }
    })
    return {
      type: 'pane',
      pane: {
        id: pane.id as string,
        surfaces,
        activeSurfaceId: pane.activeSurfaceId as string
      }
    }
  }
  return {
    type: 'split',
    id: value.id as string,
    direction: value.direction as 'row' | 'column',
    sizes: [...(value.sizes as number[])],
    children: (value.children as unknown[]).map((child) => normalizeLayoutNode(child)!)
  }
}

// ── updates (all return a NEW tree) ──────────────────────────────────────────

/** Replace one pane's contents via `fn`. */
function updatePane(node: LayoutNode, paneId: string, fn: (p: Pane) => Pane): LayoutNode {
  if (node.type === 'pane') {
    return node.pane.id === paneId ? { type: 'pane', pane: fn(node.pane) } : node
  }
  return { ...node, children: node.children.map((c) => updatePane(c, paneId, fn)) }
}

/** Split `paneId` into `[oldPane, newPane]` along `direction` (nested binary split). */
export function splitPane(
  node: LayoutNode,
  paneId: string,
  direction: 'row' | 'column',
  newPane: Pane
): LayoutNode {
  if (node.type === 'pane') {
    if (node.pane.id !== paneId) return node
    return {
      type: 'split',
      id: uid('split'),
      direction,
      sizes: [0.5, 0.5],
      children: [
        { type: 'pane', pane: node.pane },
        { type: 'pane', pane: newPane }
      ]
    }
  }
  return { ...node, children: node.children.map((c) => splitPane(c, paneId, direction, newPane)) }
}

/** Remove a pane and collapse its parent split. Returns null if the tree empties. */
export function closePane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'pane') return node.pane.id === paneId ? null : node

  const children: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, i) => {
    const res = closePane(child, paneId)
    if (res !== null) {
      children.push(res)
      sizes.push(node.sizes[i])
    }
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0] // collapse split with one child
  const sum = sizes.reduce((a, b) => a + b, 0)
  return { ...node, children, sizes: sizes.map((s) => s / sum) }
}

/** Add a new surface (tab) to a pane and make it active. */
export function addSurface(node: LayoutNode, paneId: string, surface: Surface): LayoutNode {
  return updatePane(node, paneId, (p) => ({
    ...p,
    surfaces: [...p.surfaces, surface],
    activeSurfaceId: surface.id
  }))
}

/** Remove a surface (tab). If it was the last one, the pane is left empty for the
 *  caller to close via closePane. Reassigns the active surface if needed. */
export function closeSurface(node: LayoutNode, paneId: string, surfaceId: string): LayoutNode {
  return updatePane(node, paneId, (p) => {
    const surfaces = p.surfaces.filter((s) => s.id !== surfaceId)
    if (surfaces.length === 0) return p
    const stillActive = surfaces.some((s) => s.id === p.activeSurfaceId)
    return {
      ...p,
      surfaces,
      activeSurfaceId: stillActive ? p.activeSurfaceId : surfaces[surfaces.length - 1].id
    }
  })
}

export function setActiveSurface(node: LayoutNode, paneId: string, surfaceId: string): LayoutNode {
  return updatePane(node, paneId, (p) =>
    p.surfaces.some((s) => s.id === surfaceId) ? { ...p, activeSurfaceId: surfaceId } : p
  )
}

export function updatePreviewSurfaceUrl(
  node: LayoutNode,
  surfaceId: string,
  url: string
): LayoutNode {
  if (node.type === 'pane') {
    if (!node.pane.surfaces.some((surface) => surface.id === surfaceId)) return node
    return {
      type: 'pane',
      pane: {
        ...node.pane,
        surfaces: node.pane.surfaces.map((surface) =>
          surface.id === surfaceId && surface.panel.type === 'preview'
            ? { ...surface, panel: { type: 'preview', url } }
            : surface
        )
      }
    }
  }
  return {
    ...node,
    children: node.children.map((child) => updatePreviewSurfaceUrl(child, surfaceId, url))
  }
}

/** Drag a split boundary: give `deltaFraction` from child `index+1` to child `index`,
 *  clamped so neither side drops below MIN_FRACTION. Sum stays 1. */
export function resizeSplit(
  node: LayoutNode,
  splitId: string,
  index: number,
  deltaFraction: number
): LayoutNode {
  if (node.type === 'pane') return node
  if (node.id === splitId) {
    const sizes = [...node.sizes]
    const a = sizes[index]
    const b = sizes[index + 1]
    let delta = deltaFraction
    delta = Math.max(delta, MIN_FRACTION - a) // a + delta >= MIN
    delta = Math.min(delta, b - MIN_FRACTION) // b - delta >= MIN
    sizes[index] = a + delta
    sizes[index + 1] = b - delta
    return { ...node, sizes }
  }
  return {
    ...node,
    children: node.children.map((c) => resizeSplit(c, splitId, index, deltaFraction))
  }
}

// ── layout (tree → rectangles + dividers) ────────────────────────────────────

/** Walk the tree assigning each pane a % rectangle, and each split-boundary a divider. */
export function computeLayout(root: LayoutNode): {
  panes: PlacedPane[]
  dividers: PlacedDivider[]
} {
  const panes: PlacedPane[] = []
  const dividers: PlacedDivider[] = []
  walk(root, { left: 0, top: 0, width: 100, height: 100 }, panes, dividers)
  return { panes, dividers }
}

function walk(node: LayoutNode, rect: Rect, panes: PlacedPane[], dividers: PlacedDivider[]): void {
  if (node.type === 'pane') {
    panes.push({ pane: node.pane, rect })
    return
  }
  const isRow = node.direction === 'row'
  let acc = 0
  node.children.forEach((child, i) => {
    const frac = node.sizes[i]
    const childRect: Rect = isRow
      ? {
          left: rect.left + rect.width * acc,
          top: rect.top,
          width: rect.width * frac,
          height: rect.height
        }
      : {
          left: rect.left,
          top: rect.top + rect.height * acc,
          width: rect.width,
          height: rect.height * frac
        }
    walk(child, childRect, panes, dividers)
    acc += frac
    if (i < node.children.length - 1) {
      dividers.push(
        isRow
          ? {
              id: `${node.id}:${i}`,
              splitId: node.id,
              index: i,
              direction: 'row',
              leftPct: rect.left + rect.width * acc,
              topPct: rect.top,
              lengthPct: rect.height,
              splitExtentPct: rect.width
            }
          : {
              id: `${node.id}:${i}`,
              splitId: node.id,
              index: i,
              direction: 'column',
              leftPct: rect.left,
              topPct: rect.top + rect.height * acc,
              lengthPct: rect.width,
              splitExtentPct: rect.height
            }
      )
    }
  })
}
