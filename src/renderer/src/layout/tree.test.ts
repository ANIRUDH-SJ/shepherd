// Headless logic test for the pure tiling functions. Run: `npx tsx <thisfile>`.
// This lets us verify the tree + geometry math WITHOUT a GUI (the one part we
// can't eyeball). Not a formal test runner — just asserts + a nonzero exit.
import {
  initialTree,
  splitPane,
  closePane,
  addSurface,
  closeSurface,
  resizeSplit,
  computeLayout,
  listSurfaceIds,
  findPane,
  makePane,
  makeSurface
} from './tree'
import type { LayoutNode } from './types'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log('  ok:', msg)
  else {
    console.error('FAIL:', msg)
    failures++
  }
}
const approx = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9
const splitId = (n: LayoutNode): string => (n.type === 'split' ? n.id : '')

// ── initial tree ─────────────────────────────────────────────
const initial = initialTree()
let root = initial.root
const firstId = initial.activePaneId
assert(root.type === 'pane', 'initial root is a single pane')
assert(listSurfaceIds(root).length === 1, 'initial tree has exactly 1 surface')

// ── split right (row) ────────────────────────────────────────
const paneB = makePane(makeSurface())
root = splitPane(root, firstId, 'row', paneB)
const outer = splitId(root)
assert(root.type === 'split' && root.direction === 'row', 'split-right makes a row split')
assert(listSurfaceIds(root).length === 2, '2 surfaces after split')
let layout = computeLayout(root)
assert(layout.panes.length === 2, 'computeLayout: 2 panes')
assert(approx(layout.panes[0].rect.width, 50) && approx(layout.panes[1].rect.width, 50), 'panes are 50/50 wide')
assert(layout.dividers.length === 1 && layout.dividers[0].direction === 'row', 'one row divider')
assert(approx(layout.dividers[0].leftPct, 50), 'divider sits at 50%')

// ── split the right pane downward (column) ───────────────────
const paneC = makePane(makeSurface())
root = splitPane(root, paneB.id, 'column', paneC)
assert(listSurfaceIds(root).length === 3, '3 surfaces after nested split')
layout = computeLayout(root)
assert(layout.panes.length === 3, 'computeLayout: 3 panes')
const rightPanes = layout.panes.filter((p) => approx(p.rect.left, 50))
assert(rightPanes.length === 2, 'two panes stacked on the right half')
assert(rightPanes.every((p) => approx(p.rect.width, 50)), 'right panes are 50% wide')
assert(rightPanes.every((p) => approx(p.rect.height, 50)), 'right panes are 50% tall each')

// ── resize the outer split: left pane → 70% ──────────────────
root = resizeSplit(root, outer, 0, 0.2)
layout = computeLayout(root)
const left = layout.panes.find((p) => approx(p.rect.left, 0))!
assert(approx(left.rect.width, 70), 'left pane resized to 70%')

// ── resize clamp: cannot shrink below 10% ────────────────────
root = resizeSplit(root, outer, 0, -10)
layout = computeLayout(root)
const leftClamped = layout.panes.find((p) => approx(p.rect.left, 0))!
assert(leftClamped.rect.width >= 10 - 1e-9, 'left pane clamped to >= 10%')

// ── add + close a tab (surface) ──────────────────────────────
const extra = makeSurface()
root = addSurface(root, firstId, extra)
assert(findPane(root, firstId)!.surfaces.length === 2, 'pane has 2 surfaces after addSurface')
assert(findPane(root, firstId)!.activeSurfaceId === extra.id, 'new surface becomes active')
root = closeSurface(root, firstId, extra.id)
assert(findPane(root, firstId)!.surfaces.length === 1, 'back to 1 surface after closeSurface')
assert(findPane(root, firstId)!.activeSurfaceId !== extra.id, 'active reassigned after closing active tab')

// ── close a pane → collapse ──────────────────────────────────
const before = listSurfaceIds(root).length
const collapsed = closePane(root, paneB.id)
assert(collapsed !== null, 'tree not empty after closing one pane')
assert(listSurfaceIds(collapsed!).length === before - 1, 'exactly one fewer surface after closePane')

// ── positional numbering: order in listSurfaceIds IS the number ──
// (after the ops above there are 3 surfaces across 3 panes)
const order = listSurfaceIds(root)
assert(order.length === 3, 'three surfaces in tree order')
// close the pane holding the 2nd surface → the 3rd becomes the 2nd position
const afterClose = closePane(root, paneB.id)!
assert(listSurfaceIds(afterClose).length === 2, 'two surfaces remain, renumbered by position')

console.log(failures === 0 ? '\n✅ ALL LAYOUT TESTS PASS' : `\n❌ ${failures} FAILURE(S)`)
if (failures > 0) throw new Error(`${failures} layout test(s) failed`)
