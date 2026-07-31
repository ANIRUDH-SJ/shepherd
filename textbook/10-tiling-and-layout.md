# Chapter 10 — Tiling & Layout: How Split Panes Work

> **What you'll learn**
>
> - Why a workspace's layout has to be a **tree**, and why a flat list of rectangles falls apart the moment you resize or close anything
> - The one data structure that runs the whole chapter — `PaneNode`, a leaf-or-split discriminated union — mapped picture-for-picture onto what's on screen
> - The **split** operation as a pure tree transformation: replace a leaf with a two-child split, written as an immutable `splitPane(tree, targetId, dir)`
> - The **close** operation and the _collapse_ rule (a split with one child left _becomes_ that child), written as `closePane(tree, targetId)`
> - How **resizing** works: fractional `sizes`, a draggable divider, and the pixels-to-fractions math that keeps a drag smooth at 60fps
> - A **full recursive renderer** that turns the tree into nested flexbox — including the CSS, and the `min-width:0` / `min-height:0` gotcha (building on `REFRESHER.md` §4) that is the single reason terminals can shrink at all
> - The nasty **remount-on-restructure** bug that destroys terminal scrollback, and the terminal-registry / portal pattern that fixes it
> - **Build-your-own vs a library** — react-mosaic, rc-dock, allotment — with a recommendation and the trade-offs behind it
> - **Focus management**: tracking the active pane, drawing the focus ring, and keyboard navigation between panes (Alt+arrows) that doesn't fight the terminal
>
> **Prerequisites:** `08-react-in-this-app.md` (the recursive `PaneTree`, the control-plane / data-plane split, and _why the xterm `Terminal` must live in a ref_) and `09-typescript-and-the-data-model.md` (the `PaneNode` discriminated union and the `Window → Workspace → Pane → Surface → Panel` model you're about to operate on). This chapter is the geometry that `08` deliberately left as a placeholder.

---

## 10.1 The problem: arbitrary, resizable, closable splits

Open cmux (or tmux, or any serious terminal) and you can do this without thinking:

- Press the "split right" key — the current pane shrinks to the left half; a new terminal fills the right half.
- Focus that new pane, press "split down" — _it_ halves, top and bottom.
- Grab the border between any two panes and **drag** it — the two neighbours re-share the space, live.
- Close any pane — the space it occupied **reflows** into whatever was beside it, with no gap left behind.

Every one of those actions can be applied to _any_ pane, _any_ number of times, in _any_ order. There is no fixed grid, no "you get four quadrants." You can end up with layouts like this:

```
┌───────────────┬───────────────┐
│               │       B       │
│               ├───────┬───────┤
│       A       │   C   │   D   │
│               ├───────┴───────┤
│               │       E       │
└───────────────┴───────────────┘
```

That is _left/right_ at the top level (A beside the rest), then _top/middle/bottom_ on the right (B, the C|D row, E), then _left/right_ again in the middle (C beside D). Splits nested inside splits inside splits.

Now, how would you _store_ that? The tempting first idea is a **flat list of rectangles** — each pane gets an `{x, y, width, height}`:

```ts
// ❌ the naive model — a bag of rectangles
const panes = [
  { id: 'A', x: 0, y: 0, w: 0.5, h: 1 },
  { id: 'B', x: 0.5, y: 0, w: 0.5, h: 0.33 },
  { id: 'C', x: 0.5, y: 0.33, w: 0.25, h: 0.34 }
  // ...D, E
]
```

Watch it collapse under the two operations that matter:

- **Resize.** You drag the border between A and the right column. Which rectangles move? _A_, obviously — but also B, C, D, and E, because they all start where A ends. Their `x` and `w` all depend on A's `w`. The flat list has **no idea these five share an edge**; that relationship lives only in your head. To resize correctly you'd have to re-derive, every drag, which rectangles are "downstream" of the border you grabbed. That's a geometry solver, and you'd be writing it by hand.
- **Close.** You close C. Its space should flow into D (they were side by side). But with a flat list, closing C leaves a hole; nothing tells you D is the one that should grow, or by how much. You're back to scanning coordinates to reconstruct adjacency.

The flat list throws away the one thing you need: **which panes share which boundary, and how the space is nested.** That information isn't decoration — it _is_ the layout. So we need a structure that stores it directly.

> **🔧 In Shepherd:** this is the same lesson as the object model in chapter 1, one level down. cmux's hierarchy is `Window → Workspace → Pane → Surface → Panel`. This chapter is entirely about the arrow between **Workspace and Pane** — a workspace doesn't hold a _list_ of panes, it holds a _tree_ of them, and that tree is the field `Workspace.layout`.

---

## 10.2 The core idea: layout is a tree

Here is the whole insight, and everything else in the chapter is a consequence of it:

> **A layout is a binary-ish tree. Every _leaf_ is a pane. Every _internal node_ is a split: a direction, a set of child sizes, and its children.**

Splitting a pane doesn't add a rectangle to a list — it grows the tree by one node. Closing a pane prunes a leaf. Resizing tweaks a number on an internal node. The adjacency the flat list lost is now _structural_: two panes share a border **exactly when they're children of the same split**.

You already met the type in chapter 9. Here it is again, because we're about to spend a whole chapter operating on it:

```ts
type PanelType = 'terminal' | 'browser'
interface Panel {
  id: string
  type: PanelType
  ptyId?: string
  url?: string
}
interface Surface {
  id: string
  title: string
  panel: Panel
} // a tab
interface Pane {
  id: string
  surfaces: Surface[]
  activeSurfaceId: string
}

// THE layout tree — a leaf-or-split discriminated union:
type PaneNode =
  | { kind: 'leaf'; pane: Pane }
  | { kind: 'split'; dir: 'row' | 'col'; sizes: number[]; children: PaneNode[] }
```

Read the two variants out loud:

- **`leaf`** — a single `Pane` sitting in the layout. A `Pane` is _not_ just a terminal; it's a tab strip (`surfaces`) with one active tab, and each tab (`Surface`) holds a `Panel` (a terminal, in v1). All of that is chapter 8's territory; from this chapter's point of view, a leaf is an **opaque box we place and size**.
- **`split`** — an internal node. `dir` is how its `children` are arranged; `sizes` is one weight per child (how the space is shared); `children` are more `PaneNode`s, so splits nest arbitrarily.

### The tree, drawn against the screen

Start with one pane. The tree is a single leaf:

```
Screen:                     Tree:
┌───────────────┐
│               │
│       A       │           leaf(A)
│               │
└───────────────┘
```

Split A to the **right**. The leaf is _replaced_ by a `row` split with two children:

```
Screen:                     Tree:
┌───────┬───────┐
│       │       │           split(dir:'row', sizes:[1,1])
│   A   │   B   │           ├─ leaf(A)
│       │       │           └─ leaf(B)
└───────┴───────┘
        ▲ a vertical divider — drag it to change sizes[0] vs sizes[1]
```

Now focus B and split it **down**. B's leaf becomes a `col` split — and notice the top-level `row` split is untouched:

```
Screen:                     Tree:
┌───────┬───────┐
│       │   B   │           split(dir:'row', sizes:[1,1])
│   A   ├───────┤           ├─ leaf(A)
│       │   C   │           └─ split(dir:'col', sizes:[1,1])
└───────┴───────┘              ├─ leaf(B)
                               └─ leaf(C)
```

That "the rest of the tree is untouched" property is the entire payoff. A split only ever restructures the _one leaf_ you acted on. Everything else keeps its shape and its sizes for free — no geometry solver, no coordinate bookkeeping.

> **⚠️ Gotcha — `row`/`col` names the _arrangement_, not the divider.** `dir: 'row'` means the children are laid out **along a row → side by side**, which puts a **vertical** divider between them. `dir: 'col'` stacks them top-to-bottom with a **horizontal** divider. People muddle this constantly (vim calls a side-by-side split "vertical"; tmux calls it "horizontal"). We sidestep the argument by naming the field after **flexbox's `flex-direction`**, which is exactly what it becomes in §10.6. `REFRESHER.md` §4 wrote `.panes.vertical { flex-direction: column }` — that `.vertical` class is our `dir: 'col'`. Same thing, less ambiguous name.

> **🔧 In Shepherd:** the two split keys mirror cmux: **split-right → a `row` split**, **split-down → a `col` split**. The socket API (`11-the-socket-api.md`) exposes the same four directions — `surface.split { direction: 'left' | 'right' | 'up' | 'down' }` — which map onto our two `dir` values plus a _side_: right/left → `row` (new pane after/before), down/up → `col` (after/before). We'll write that adapter in §10.10.

---

## 10.3 The split operation

Splitting is the tree's defining move, and it's beautifully simple once you see it as a _node replacement_:

> **To split leaf `T`: replace it with a `split` node whose two children are the old `T` and a brand-new leaf.**

That's it. Here's the transformation on any leaf `T`, wherever it sits in the tree:

```
        …parent…                              …parent…
           │                                     │
        leaf(T)              ──split(dir)──►   split(dir, sizes:[1,1])
                                                 ├─ leaf(T)      ← the original, untouched
                                                 └─ leaf(NEW)    ← the fresh pane
```

Concretely, splitting A to the right in a workspace that was just `leaf(A)`:

```
BEFORE                          AFTER  splitPane(tree, 'A', 'row')

leaf(A)          ──────►         split(dir:'row', sizes:[1,1])
                                 ├─ leaf(A)
                                 └─ leaf(B)   ← B is new
```

And splitting a _nested_ leaf leaves its ancestors alone. Splitting C (down) inside our earlier tree:

```
BEFORE                                  AFTER  splitPane(tree, 'C', 'col')

split(row)                              split(row)
├─ leaf(A)                              ├─ leaf(A)
└─ split(col)                           └─ split(col)
   ├─ leaf(B)          ──────►             ├─ leaf(B)
   └─ leaf(C)                              └─ split(dir:'col', sizes:[1,1])   ← C was here
                                              ├─ leaf(C)
                                              └─ leaf(D)   ← D is new
```

### `splitPane` — the pure function

The implementation is a recursive walk that rebuilds the tree, replacing exactly the one leaf whose `pane.id` matches. It's **pure**: it takes a tree and returns a _new_ tree, mutating nothing.

```ts
const leaf = (pane: Pane): PaneNode => ({ kind: 'leaf', pane })

function splitPane(
  tree: PaneNode,
  targetId: string, // the PANE id of the leaf to split
  dir: 'row' | 'col', // orientation of the new split
  newPane: Pane, // the pane to place alongside the target
  where: 'after' | 'before' = 'after'
): PaneNode {
  // BASE CASE: a leaf. Split it iff it's the one we're targeting.
  if (tree.kind === 'leaf') {
    if (tree.pane.id !== targetId) return tree // not this leaf → hand it back unchanged
    const children =
      where === 'after'
        ? [tree, leaf(newPane)] // old first, new second
        : [leaf(newPane), tree] // new first, old second
    return { kind: 'split', dir, sizes: [1, 1], children } // 50 / 50 by weight
  }

  // RECURSIVE CASE: a split. Rebuild its children; only the branch containing
  // the target actually changes — the rest return `tree` unchanged from the base case.
  return {
    ...tree,
    children: tree.children.map((child) => splitPane(child, targetId, dir, newPane, where))
  }
}
```

**Walkthrough:**

- **Base case is where the work happens.** We recurse down to leaves; when we hit the _matching_ leaf, we return a fresh two-child `split` in its place. Every _non_-matching leaf returns itself untouched.
- **`sizes: [1, 1]`** means "two children, equal weight" — a 50/50 split. Sizes are **relative weights**, not pixels or percentages (that's what makes them survive window resizes; §10.5).
- **`where`** picks the order. Split _right_/_down_ puts the new pane `after`; split _left_/_up_ puts it `before`. That single flag is how one function serves all four directions.
- **Immutability is not optional.** We build new objects (`{ ...tree, children: … }`) rather than pushing into `tree.children`. This is the same rule as `REFRESHER.md` §1 ("never mutate state directly") and chapter 8's whole state story: main owns the tree, React mirrors it, and a mutated-in-place tree would break both change detection and undo/persistence. `splitPane(old)` → `new`; you then _set_ the new tree.

> **⚠️ Gotcha — creating the pane is a two-step dance.** `newPane` here is a plain data object; it has a `Panel` of `type: 'terminal'` but **no live shell yet**. The actual pty is spawned in the _main_ process (chapter 6), which fills in `panel.ptyId`. So the real flow is: renderer asks main to split → main creates the `Pane`, spawns its node-pty, sets `ptyId`, runs `splitPane` on `Workspace.layout`, and pushes the new tree back. Don't try to `new Terminal()` and split in one renderer-side step; the pane's identity is minted by main. (More in §10.10.)

### A refinement worth knowing: flatten same-direction splits

Our `splitPane` _always wraps_ the target in a new split. If you split A right, then split A right _again_, you get a nested tree:

```
split(row)[ split(row)[A, B], C ]      ← nested: A|B share a sub-row, that sub-row sits beside C
```

Visually that's still "A | B | C" left to right, but structurally it's lopsided, and dragging the outer divider resizes _the A|B group_ against C rather than A against B. tmux and most tilers **flatten**: if the target's parent is already a split in the _same_ `dir`, they _insert the new leaf as a sibling_ instead of wrapping:

```
split(row)[ A, B, C ]                  ← flat: three equal children in one row
```

Flattening is a nice polish (it makes repeated same-direction splits behave the way users expect), but it's strictly an optimization on top of the always-wrap core. Build the wrapping version first; add flattening when the nesting starts to annoy you. The rest of this chapter — close, resize, render — works identically for two-child and N-child splits, so nothing downstream cares which you choose.

---

## 10.4 The close operation (and the collapse rule)

Closing a pane is where the tree earns its keep, because of one rule that a flat list could never express cleanly:

> **When you remove a leaf, its parent split may be left with a single child. A split with one child is meaningless — so it _collapses_: the split is replaced by its lone remaining child.**

Skip the collapse and your tree fills with degenerate one-child splits — dividers that separate a pane from _nothing_, wasted nesting, and a resize/serialize path full of special cases. Collapsing keeps the tree **minimal**: every split always has ≥2 children.

Watch it. Close C from our nested tree:

```
BEFORE close C                          AFTER  closePane(tree, 'C')

split(row)                              split(row)
├─ leaf(A)                              ├─ leaf(A)
└─ split(col)          ──────►          └─ leaf(B)     ← the col-split had only B left,
   ├─ leaf(B)                                            so it BECAME leaf(B)
   └─ leaf(C) ✗
```

On screen, C's space flows into B (its sole neighbour), and the horizontal divider that separated them vanishes:

```
┌───────┬───────┐                       ┌───────┬───────┐
│       │   B   │                        │       │       │
│   A   ├───────┤        ──────►         │   A   │   B   │
│       │   C ✗ │                        │       │       │
└───────┴───────┘                       └───────┴───────┘
```

The collapse can **bubble up several levels** in one close. If B and C were the only two panes on the right, closing C collapses the `col` split into `leaf(B)`; if that `col` split had _itself_ been the only child of something, that would collapse too. Because our function is recursive and returns "the (possibly collapsed) subtree," the bubbling happens automatically — you don't write a loop for it.

### `closePane` — the pure function

```ts
function closePane(tree: PaneNode, targetId: string): PaneNode | null {
  // BASE CASE: a leaf. Return null ("I'm gone") if it's the target, else itself.
  if (tree.kind === 'leaf') {
    return tree.pane.id === targetId ? null : tree
  }

  // RECURSIVE CASE: rebuild children, dropping any that came back null.
  // Keep each surviving child's size weight aligned with it.
  const keptChildren: PaneNode[] = []
  const keptSizes: number[] = []
  tree.children.forEach((child, i) => {
    const result = closePane(child, targetId)
    if (result !== null) {
      keptChildren.push(result)
      keptSizes.push(tree.sizes[i])
    }
  })

  if (keptChildren.length === 0) return null // the whole subtree is gone (bubbles up)
  if (keptChildren.length === 1) return keptChildren[0] // ── COLLAPSE: split → its one child
  return { ...tree, children: keptChildren, sizes: keptSizes }
}
```

**Walkthrough:**

- **`null` is the "prune me" signal.** A leaf returns `null` when it's the target. A split whose _only surviving child was the target_ ends up with `keptChildren.length === 0` and returns `null` too — the signal propagates upward without any special handling.
- **The collapse is `length === 1`.** After filtering, if exactly one child remains, we _return that child directly_ in place of the split. That single line is the entire collapse rule.
- **Sizes travel with their children.** We push `tree.sizes[i]` alongside `keptChildren[i]` so the survivors keep their weights. (Removing a child means the remaining weights no longer "fill" as before — flexbox handles that automatically because weights are relative, but if you prefer, renormalize `keptSizes` to sum to the original total. Cosmetic either way.)
- **Returns `PaneNode | null`.** The top-level caller must handle `null` — that's "you closed the _last_ pane in the workspace." Depending on product choice, main then closes the workspace, or seeds a fresh `leaf(newTerminalPane())` so a workspace is never empty.

> **🔧 In Shepherd:** closing a pane is not just a tree edit — it must also **kill the pane's shell**. Before (or after) `closePane`, main looks up every `ptyId` under the removed leaf and calls `pty.kill()` (chapter 6), and tells the renderer to `dispose()` the corresponding xterm instances (chapter 7). Prune the tree _and_ release the OS resources; a closed pane that leaves a zombie `bash` running is a leak you'll only notice when your process list is a mess.

---

## 10.5 Resizing: fractional sizes and a draggable divider

Sizes are the numbers on each split node, and getting their _meaning_ right is what makes resizing trivial.

**`sizes` are relative weights, one per child — not pixels, not percentages.** A split with `sizes: [1, 1]` gives each child an equal share; `[2, 1]` gives the first child twice the space of the second; `[3, 1, 1]` is 60% / 20% / 20%. The absolute numbers don't matter, only their ratios — which is exactly `flex-grow` semantics, and exactly why we can hand `sizes[i]` straight to `flexGrow` in §10.6.

Why weights instead of percentages or pixels? Because the window resizes. If you stored pixels, every pane would need recomputing whenever the OS window changed size. Weights are **resolution-independent**: "this pane gets twice its neighbour" is true at 800px wide and at 3000px wide. Flexbox resolves weights → pixels for you, every frame, for free.

### The divider drag, end to end

A **divider** is the thin bar rendered _between_ two children of a split. Dragging it moves space from one side to the other by adjusting _those two_ weights (all other children are untouched):

```
sizes: [1, 1]            drag divider →           sizes: [1.6, 0.4]
┌───────┬───────┐                                ┌───────────┬───┐
│   A   │   B   │        ──────────►              │     A     │ B │
└───────┴───────┘                                └───────────┴───┘
     50 / 50                                          80 / 20
```

The math is the only subtle part, and it's short. When the user grabs the divider between child `i` and child `i+1`:

1. **Snapshot** the sizes _and_ the container's main-axis length in pixels _at the moment the drag starts_. (Snapshotting is what makes the drag stable across the re-renders it triggers — see the gotcha.)
2. On each pointer move, take the pixel delta from the start point.
3. Convert pixels → weight: `deltaWeight = (deltaPx / containerPx) * sumOfWeights`.
4. Add `deltaWeight` to child `i`, subtract it from child `i+1`, **clamping** so neither drops below a minimum (a pane must never hit zero and disappear).
5. Push the new `sizes` array into state.

Here's the split-rendering component's resize handler (the surrounding renderer is §10.6):

```tsx
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function beginResize(
  node: Extract<PaneNode, { kind: 'split' }>,
  path: number[], // where this split lives in the tree (see §10.6)
  dividerIndex: number, // divider between child i and i+1
  container: HTMLElement,
  onResize: (path: number[], sizes: number[]) => void,
  e: React.PointerEvent
) {
  e.preventDefault()
  const isRow = node.dir === 'row'

  // ── 1) snapshot everything at drag start ──
  const total = isRow ? container.clientWidth : container.clientHeight
  const startPos = isRow ? e.clientX : e.clientY
  const start = [...node.sizes] // a COPY, frozen at t=0
  const sum = start.reduce((a, b) => a + b, 0)
  const MIN = 0.05 * sum // no pane below ~5% of this split
  const i = dividerIndex
  const pairTotal = start[i] + start[i + 1] // the two neighbours share this much weight

  const move = (ev: PointerEvent) => {
    const pos = isRow ? ev.clientX : ev.clientY
    const deltaWeight = ((pos - startPos) / total) * sum // ── 3) px → weight
    // ── 4) move weight from i+1 to i, keep their sum constant, clamp both ──
    const a = clamp(start[i] + deltaWeight, MIN, pairTotal - MIN)
    const next = [...start]
    next[i] = a
    next[i + 1] = pairTotal - a
    onResize(path, next) // ── 5) commit new sizes
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
```

**Why it's shaped this way:**

- **Only two weights change.** `next[i]` and `next[i+1]` move in opposite directions and always sum to `pairTotal`. Every other child's weight is copied verbatim, so the rest of the layout is rock-steady while you drag one border.
- **The clamp is load-bearing.** `clamp(..., MIN, pairTotal - MIN)` guarantees _both_ neighbours keep at least `MIN` weight — you physically cannot drag a pane to nothing. Without it, a fast drag sets a size to `0` (or negative), the pane vanishes, and you can never grab its divider again.
- **Pointer capture, `window`-level listeners.** We attach `pointermove`/`pointerup` to `window` (not the divider) so the drag keeps tracking even when the cursor outruns the 6px bar. (In the real component, also call `el.setPointerCapture(e.pointerId)` on the divider.)

> **⚠️ Gotcha — snapshot at drag start, or the drag will "run away."** Notice `start = [...node.sizes]` is captured _once_, in the closure created at pointer-down, and every move applies the _cumulative_ delta to that frozen snapshot. If you instead read `node.sizes` fresh on each move, you'd be applying each delta on top of the _already-updated_ sizes — double-counting — and the pane would accelerate away from your cursor. Freeze the start state; apply total displacement, not incremental.

> **🔧 In Shepherd:** resize is **the one interaction where you should update the renderer's mirror optimistically.** Chapter 8 (§8.6) made the case for the pessimistic round-trip — send an intent to main, wait for the pushed snapshot — as the default, because consistency beats a few milliseconds. But a divider drag fires _dozens_ of updates per second; routing every frame through IPC to main and back would make dragging feel like syrup. So: update the local `sizes` immediately (60fps smoothness), and **debounce** a single commit to main when the drag settles. Main then persists it — chapter 13 (§13.7) specifically calls out "dragging a divider fires dozens of resize events" as _the_ reason `session.json` writes are debounced. Two debounces, same motivation.

---

## 10.6 Rendering the tree in React

Now the payoff: turn a `PaneNode` into DOM. This expands the placeholder `PaneTree` from chapter 8 (§8.8) into the real thing — with dividers, sizing, focus wiring, and the CSS that makes it all shrinkable.

The rule is one-to-one:

- **A `split` node → a flex container** (`flex-direction: row` or `column`), containing its children with a `Divider` interleaved between each pair.
- **A `leaf` node → a `Pane`** — the chapter-8 component that renders `SurfaceTabs` + the terminals. The layout renderer treats it as an opaque box; it doesn't know or care what's inside.

Because a `PaneNode` instance can _change kind_ across renders (a leaf becomes a split when you split it), we must not put a hook after a `kind`-check `return` — that would violate the Rules of Hooks. So we split (pun intended) into a tiny dispatcher plus two components:

```tsx
import { Fragment, useRef } from 'react'
import type { PaneNode } from '../../shared/types'
import { Pane } from './Pane' // chapter 8: SurfaceTabs + TerminalPane × N

interface LayoutProps {
  node: PaneNode
  path: number[] // this node's route from the root ([] at the top)
  focusedId: string | null
  onFocus: (paneId: string) => void
  onResize: (path: number[], sizes: number[]) => void
}

// ── dispatcher: pick the right component so hooks stay unconditional ──
export function LayoutView(props: LayoutProps) {
  return props.node.kind === 'leaf' ? <LeafView {...props} /> : <SplitView {...props} />
}

// ── a leaf is one Pane, wrapped so it can be focused and ring-highlighted ──
function LeafView({ node, focusedId, onFocus }: LayoutProps) {
  if (node.kind !== 'leaf') return null // narrows the union for TS
  const focused = node.pane.id === focusedId
  return (
    <div
      className="pane-slot"
      data-pane-id={node.pane.id} // used by keyboard nav (§10.9)
      data-focused={focused || undefined} // CSS hook for the focus ring
      onMouseDownCapture={() => onFocus(node.pane.id)} // click anywhere in the pane → focus it
    >
      <Pane pane={node.pane} />
    </div>
  )
}

// ── a split is a flex row/col with dividers between children ──
function SplitView({ node, path, focusedId, onFocus, onResize }: LayoutProps) {
  if (node.kind !== 'split') return null // narrows the union for TS
  const containerRef = useRef<HTMLDivElement>(null)
  const cls = node.dir === 'row' ? 'split split-row' : 'split split-col'

  return (
    <div ref={containerRef} className={cls}>
      {node.children.map((child, i) => (
        <Fragment key={keyOf(child)}>
          {/* a divider sits BEFORE every child except the first */}
          {i > 0 && (
            <div
              className={`divider divider-${node.dir}`}
              onPointerDown={(e) =>
                beginResize(node, path, i - 1, containerRef.current!, onResize, e)
              }
            />
          )}
          {/* the cell: flex-grow = this child's weight; recurse into it */}
          <div className="cell" style={{ flexGrow: node.sizes[i], flexBasis: 0 }}>
            <LayoutView
              node={child}
              path={[...path, i]} // extend the path as we descend
              focusedId={focusedId}
              onFocus={onFocus}
              onResize={onResize}
            />
          </div>
        </Fragment>
      ))}
    </div>
  )
}
```

And the two small helpers it leans on — a **path** to address a split for resizing, and a **stable key** for React:

```ts
// Apply new sizes to the split at `path` (immutably), returning a new tree.
function setSizesAtPath(tree: PaneNode, path: number[], sizes: number[]): PaneNode {
  if (tree.kind !== 'split') return tree
  if (path.length === 0) return { ...tree, sizes }
  const [head, ...rest] = path
  return {
    ...tree,
    children: tree.children.map((c, i) => (i === head ? setSizesAtPath(c, rest, sizes) : c))
  }
}

// A stable React key for a subtree. Leaves key by pane.id; splits key by their
// leftmost leaf's pane.id — stable across resizes and single-child collapses.
function keyOf(node: PaneNode): string {
  return node.kind === 'leaf' ? node.pane.id : `split:${firstLeafId(node)}`
}
function firstLeafId(node: PaneNode): string {
  return node.kind === 'leaf' ? node.pane.id : firstLeafId(node.children[0])
}
```

**Walkthrough:**

- **The component tree mirrors the data tree.** `SplitView` renders a flex container; each child recurses through `LayoutView`, which dispatches to `SplitView` or `LeafView` again. The recursion bottoms out at leaves, exactly like `splitPane`/`closePane` do. Data structure and component structure are the _same shape_ — that's why this stays comprehensible at four levels of nesting.
- **`flexGrow: node.sizes[i]`, `flexBasis: 0`.** This is where weights become geometry. `flex-basis: 0` means "start every cell from zero width," then `flex-grow` distributes _all_ the space by weight — so `sizes` ratios become pixel ratios, precisely. (`flexBasis: 0` matters: with the default `auto` basis, cells would first reserve their content's natural size and only _then_ grow, so your weights would be distorted by content. Zero-basis makes the ratio exact.)
- **`path` addresses splits for resize.** Leaves are addressed by `pane.id` (in `splitPane`/`closePane`); splits have no id, so we address them by their **index route from the root**, accumulated as we recurse (`[...path, i]`). `beginResize` hands that path to `onResize`, which calls `setSizesAtPath`. Clean, and no id field needed on split nodes.
- **`key={keyOf(child)}` — never the index.** Chapter 8 (§8.10) drilled this: an index key can make React reuse the wrong instance and _remount a terminal_, destroying its scrollback. Here we key leaves by `pane.id` and splits by their leftmost leaf's id — both stable across resizing and across a sibling collapsing. (It's still not bulletproof across _restructures_; that's the next section.)

### The CSS — and the `min-width:0` gotcha that the whole thing hinges on

```css
/* a split node becomes a flex container */
.split {
  display: flex;
  width: 100%;
  height: 100%;
}
.split-row {
  flex-direction: row;
} /* children side by side, vertical dividers   */
.split-col {
  flex-direction: column;
} /* children stacked,      horizontal dividers */

/* each child cell: grow by weight (set inline), and — critically — allow shrinking */
.cell {
  flex-grow: 1; /* overridden inline with node.sizes[i] */
  flex-shrink: 1;
  flex-basis: 0;
  min-width: 0; /* ⬅ THE gotcha */
  min-height: 0; /* ⬅ THE gotcha */
  overflow: hidden;
}

/* the leaf wrapper — same shrink rules, plus a focus ring */
.pane-slot {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.pane-slot[data-focused] {
  box-shadow: inset 0 0 0 2px #1f6feb; /* inset so overflow:hidden can't clip it */
}

/* the drag handles */
.divider {
  flex: 0 0 6px;
  background: #2a2a2a;
}
.divider:hover {
  background: #1f6feb;
}
.divider-row {
  cursor: col-resize;
} /* vertical bar → resize left/right */
.divider-col {
  cursor: row-resize;
} /* horizontal bar → resize up/down  */
```

Now the gotcha, because it is the difference between "terminals tile perfectly" and "terminals blow out of their boxes and the dividers drift off screen." `REFRESHER.md` §4 flagged it in one line:

> _"a flex child won't shrink below its content unless you set `min-width: 0` / `min-height: 0`. Terminals overflow without it — remember this one."_

Here's the _why_, because you need to understand it to debug it. **A flex item's default `min-width` is `auto`, not `0`.** `auto` means "never shrink me smaller than my content's intrinsic size." For most content that's harmless. But an xterm terminal's content is a `<canvas>` (or a grid of glyphs) whose intrinsic width is _the full width of its current text_ — often much wider than the space you want to give it. So with the default `min-width: auto`:

- The terminal cell refuses to shrink below its content width.
- It overflows its cell, shoving its neighbour and the divider sideways.
- Nested one level deeper, it compounds: each ancestor also refuses to shrink, and the whole right side of your layout marches off the edge of the window.

Setting `min-width: 0` (and `min-height: 0` for `col` splits) overrides that default and says "you _may_ shrink below content; clip or reflow as needed." Now the terminal obeys its flex weight, and `FitAddon` (chapter 7) reflows the shell's columns to match. **You need it at every level of the nesting** — on the cells _and_ on the pane wrapper — because each flex item independently defaults to `min-width: auto`. Miss it on one intermediate cell and that branch alone will overflow.

> **⚠️ Gotcha — this is the "terminal is one column too wide / dividers drift" bug, and it is always `min-width`.** When a tiled terminal renders too wide, pushes its divider, or won't shrink when you drag, your first and usually only suspect is a flex item missing `min-width: 0` / `min-height: 0`. It's the most common flexbox-plus-terminal bug there is, and now you know it on sight. (`REFRESHER.md` §4 has the shorthand `.pane { flex: 1 1 0; min-width: 0; min-height: 0; }` — same fix, memorize it.)

---

## 10.7 Keeping terminals alive across restructures

There's a deeper rendering problem hiding under §10.6, and it's the kind that ships as a bug because everything _looks_ right until you split or close a pane and a terminal you weren't even touching goes blank. It's worth its own section because the fix is a genuinely useful pattern.

**The problem: restructuring the tree moves subtrees to new parents, and moving a React subtree to a new parent _remounts_ it.** React can preserve a component instance when it stays put or reorders among siblings (that's what keys are for). It **cannot** preserve one that changes depth or parent — that's always unmount-then-mount. And restructures do exactly that:

- **Split.** `splitPane` turns `leaf(A)` into `split[leaf(A), leaf(NEW)]`. The node at that path was rendered by `LeafView`; now it's a `SplitView` with a `LeafView(A)` _underneath_ it. Component A moved down a level → **A remounts.**
- **Close/collapse.** Closing C collapses `split[B, C]` into `B`. B was at path `[1,0]`; now it's at `[1]`, under a _different_ parent element → **B remounts.**

And remounting a `TerminalPane` runs its `useEffect` cleanup — `term.dispose()` — which destroys the xterm canvas _and its scrollback_ (chapter 8, §8.8 spelled out why that's so costly). So: you split pane A to open a new terminal beside it, and **A flickers and loses its history** even though you never asked to touch A. Users will not forgive this.

Stable keys (§10.6) don't save you here — they prevent remounts from _reordering_, but not from a genuine change of parent. The tree really did restructure.

**The fix: don't let the xterm instance live at the mercy of the tree.** Keep terminals in a **stable registry** — a `Map<paneId, HTMLDivElement>` in a ref (or context) at the App level — where each terminal's DOM subtree is created **once** and never unmounted by React. The layout tree renders empty _slots_; a small effect **moves** (re-parents) the terminal's existing DOM node into whichever slot currently represents its pane. Re-parenting a DOM node with `appendChild` **moves it without destroying it** — the `<canvas>`, the scrollback, the xterm instance all survive.

```tsx
// App-level: a home for terminal DOM that React's tree can't reach in to destroy.
const hosts = useRef(new Map<string, HTMLDivElement>())

function getOrCreateHost(paneId: string): HTMLDivElement {
  let host = hosts.current.get(paneId)
  if (!host) {
    host = document.createElement('div')
    host.className = 'terminal-host'
    mountXtermInto(host, paneId) // new Terminal(); term.open(host); wire pty — ONCE
    hosts.current.set(paneId, host)
  }
  return host
}

// The leaf renders an empty slot and adopts the persistent host into it.
function LeafView({ node }: { node: Extract<PaneNode, { kind: 'leaf' }> }) {
  const slotRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = getOrCreateHost(node.pane.id)
    slotRef.current!.appendChild(host) // MOVE the existing node — does NOT recreate it
    // no teardown here: on restructure the slot unmounts, but the host lives on
    // in the registry, ready to be adopted by the new slot. Dispose only on close.
  }, [node.pane.id])
  return <div className="pane-slot" data-pane-id={node.pane.id} ref={slotRef} />
}
```

Now a split or collapse can rearrange the React tree however it likes: the slots come and go, but each terminal's DOM node just gets `appendChild`-ed into its new slot, fully intact. You only ever call `term.dispose()` when the pane is genuinely **closed** (§10.4) — never as a side effect of the tree changing shape around it.

> **🔧 In Shepherd:** React's `createPortal` is the idiomatic version of this same trick — render `<TerminalPane>` into a stable off-tree container and portal it into the current slot. The manual `appendChild` above is shown because it makes the key insight unmissable: **move the node, don't recreate it.** Either way, the principle is the one from chapter 8 — the xterm instance belongs in the imperative/DOM world, decoupled from React's reconciliation — extended from "survives re-renders" to "survives _restructures_." For v1's shallow layouts you may ship without this and add it the first time someone reports "splitting cleared my other terminal." But know the fix before you need it.

---

## 10.8 Build your own, or use a library?

You've now seen the whole hand-rolled implementation — it's roughly `splitPane` + `closePane` + `setSizesAtPath` + `LayoutView` + ~40 lines of CSS. That's about 150 lines. Should you write it, or reach for a library? Three are worth knowing:

| Library          | Model it gives you                                        | Strengths                                                                      | Costs / friction for us                                                                                                                               |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **react-mosaic** | A binary tiling tree — _exactly_ our leaf/split model     | Drag-to-split, drag-to-rearrange, resize, controlled state; MIT; battle-tested | Opinionated DnD + Blueprint-flavoured styling to override; **it wants to own the tree state**, which fights "main is the source of truth" (chapter 8) |
| **allotment**    | Nestable split panes (the VS Code "Split View" engine)    | Superb resize feel, snap, min/max, collapse; tiny; unstyled/neutral            | Only _splitting/sizing_ — no split-tree editing, no DnD, no tabs; you still write `splitPane`/`closePane` yourself                                    |
| **rc-dock**      | A full **dock manager**: tabs + panels + float + maximize | Most features out of the box; IDE-like docking, floating windows               | Heaviest; imposes its _own_ tab/panel model that collides with our `Pane → Surface → Panel`; lots to fight to match cmux's look                       |

How to think about the choice, given _our_ specific situation:

- **The tree already lives in main.** Our architecture (chapter 8) puts the authoritative layout in the main process, with the renderer as a mirror. A library that insists on owning the layout state (react-mosaic, rc-dock) means running _two_ sources of truth and syncing them — precisely the "two stores that drift" trap chapter 8 warned against. That's a real cost, not a nitpick.
- **We already have a tab/panel model.** cmux's `Pane → Surface → Panel` (per-pane tab bars) is specific. rc-dock brings its own tabs-and-docks vocabulary; you'd spend your time _disabling_ its model to fit ours.
- **Pixel-exact styling is a headline goal.** `FEATURES.md` lists "dark theme matching cmux" and full CSS control as core. Hand-rolled flex is the _most_ controllable option; libraries mean overriding someone else's classes.
- **The hard part isn't the tree — it's the polish.** `splitPane`/`closePane` are easy and you understand them completely now. The genuinely fiddly bits are smooth dragging, snapping, min sizes, and touch — which is exactly what **allotment** is superb at.

**Recommendation: hand-roll the tree (own `splitPane`/`closePane`/render), and if divider polish becomes a time sink, drop _allotment_ in _underneath_ your tree for the sizing layer only.** allotment resizes; _you_ keep owning the split/close logic and the state (in main). That combination gives you full control of the model and the look, offloads only the finicky drag mechanics, and never sets up a competing source of truth. Skip **rc-dock** unless you decide you want floating/dockable windows (a different product); consider **react-mosaic** only if you'd rather not write the tree _and_ you're willing to let it own layout state and restyle it — for us, the fit is worse than it first looks.

> **🔧 In Shepherd:** `FEATURES.md` (row 5) hedges — "the `PaneNode` split tree + a tiling renderer (react-mosaic or hand-rolled flex)." This chapter is the argument for **hand-rolled**: we already own the tree in main, we already have a bespoke tab model, and we want the CSS. The library we'd _actually_ reach for is allotment, and only for the drag layer.

---

## 10.9 Focus management

A tiling terminal with three panes needs to answer, at all times: **which pane is active?** That drives three things — the visible focus ring, where keystrokes go, and what "split" / "close" / navigation act on.

### Tracking the active pane

Focus is **renderer-local UI state** (chapter 8, §8.9): a single `focusedPaneId`. It doesn't need to round-trip to main the way structural changes do — though you _can_ mirror it to main so the socket API's `surface.focus` (chapter 11) and the sidebar stay in sync. Wire it two ways:

```tsx
const [focusedId, setFocusedId] = useState<string | null>(null)

const focusPane = (paneId: string) => {
  setFocusedId(paneId)
  focusPaneTerminal(paneId) // ALSO move DOM focus to that pane's terminal (below)
}
```

- **Mouse:** the `onMouseDownCapture` in `LeafView` (§10.6) calls `onFocus(pane.id)` — click anywhere in a pane and it becomes active.
- **Follows creation:** after a split, focus the _new_ pane; after a close, focus a sensible neighbour. Main knows which pane it just made, so it can include "focus this" in the pushed snapshot.

### The focus ring

Pure CSS, driven by the `data-focused` attribute `LeafView` already sets:

```css
.pane-slot[data-focused] {
  box-shadow: inset 0 0 0 2px #1f6feb;
}
```

Use `inset` `box-shadow`, not `outline` or a border: a border would shift the terminal's layout by 2px (re-triggering a `FitAddon` reflow), and an `outline` can be clipped by the `overflow: hidden` on ancestors. An inset shadow paints _inside_ the box, over the content edge, clipping-proof and layout-neutral.

### App focus vs DOM focus — keep them married

This is the subtlety that bites everyone. There are **two** notions of "focused" and they must agree:

1. **App focus** — your `focusedId` state, which draws the ring.
2. **DOM focus** — which element the browser actually sends keystrokes to. For a terminal that's xterm's hidden helper `<textarea>`.

If the ring says pane B is focused but the DOM focus is still on pane A's textarea, the user sees B highlighted and types into A. Maddening. So whenever you set `focusedId`, also move **DOM focus** into that pane's terminal:

```tsx
function focusPaneTerminal(paneId: string) {
  // cleanest: keep a Map<paneId, Terminal> (the §10.7 registry) and call term.focus().
  // pragmatic without a registry: focus xterm's hidden textarea directly.
  const slot = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`)
  slot?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
}
```

Conversely, when the user clicks _into_ a terminal, xterm's textarea takes DOM focus and fires a focus event — let that bubble to `onFocus` so app focus follows DOM focus too. Bind them in both directions and they never disagree.

### Keyboard navigation between panes

cmux lets you jump focus directionally — think "move focus to the pane to my right." The robust way to compute "the pane in direction _X_" across an arbitrary nested tree is **geometric**: compare on-screen rectangles rather than trying to walk the tree. (A tree walk works for simple cases but gets gnarly when the visually-adjacent pane lives in a distant branch.)

```tsx
const overlap = (lo1: number, hi1: number, lo2: number, hi2: number) =>
  Math.min(hi1, hi2) - Math.max(lo1, lo2) > 0 // do two 1-D ranges overlap?

function findNeighbor(fromId: string, dir: 'left' | 'right' | 'up' | 'down'): string | null {
  const slots = Array.from(document.querySelectorAll<HTMLElement>('[data-pane-id]'))
  const from = slots.find((s) => s.dataset.paneId === fromId)
  if (!from) return null

  const a = from.getBoundingClientRect()
  const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 }

  let best: { id: string; dist: number } | null = null
  for (const s of slots) {
    if (s.dataset.paneId === fromId) continue
    const b = s.getBoundingClientRect()
    const bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    const dx = bc.x - ac.x,
      dy = bc.y - ac.y

    // candidate must lie in the requested direction AND overlap on the cross axis
    const inDir =
      dir === 'right'
        ? dx > 1 && overlap(a.top, a.bottom, b.top, b.bottom)
        : dir === 'left'
          ? dx < -1 && overlap(a.top, a.bottom, b.top, b.bottom)
          : dir === 'down'
            ? dy > 1 && overlap(a.left, a.right, b.left, b.right)
            : /* 'up' */ dy < -1 && overlap(a.left, a.right, b.left, b.right)
    if (!inDir) continue

    const dist = Math.hypot(dx, dy)
    if (!best || dist < best.dist) best = { id: s.dataset.paneId!, dist }
  }
  return best?.id ?? null
}
```

It reads every pane's rectangle from the DOM (the `data-pane-id` we already render), keeps only candidates that are genuinely in the requested direction _and_ share some cross-axis overlap (so "right" won't teleport you to a pane that's actually up-and-to-the-right), and picks the nearest. Wire it to a keymap:

```tsx
useEffect(() => {
  const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const
  const onKey = (e: KeyboardEvent) => {
    if (!e.altKey || !focusedId) return
    const dir = dirs[e.key as keyof typeof dirs]
    if (!dir) return
    const next = findNeighbor(focusedId, dir)
    if (next) {
      e.preventDefault()
      e.stopPropagation() // don't let this keystroke reach the terminal
      focusPane(next)
    }
  }
  window.addEventListener('keydown', onKey, true) // CAPTURE phase — intercept before xterm
  return () => window.removeEventListener('keydown', onKey, true)
}, [focusedId])
```

> **⚠️ Gotcha — your shortcut and the shell are fighting over the same keys.** A terminal grabs almost everything. Two collisions in particular:
>
> - **Splitting can't be `Ctrl-D`.** cmux uses ⌘D, which macOS terminals ignore. On Linux there's no ⌘, and **`Ctrl-D` is EOF** — bind "split" to it and you'll close the shell instead. Use `Ctrl+Shift+D` / `Super+D`, or another combo the shell doesn't consume.
> - **Nav keys must be intercepted _before_ xterm.** xterm forwards keystrokes to the pty. If your `Alt+Arrow` handler runs after xterm's, the shell may act on it (readline uses some `Alt`/`Meta` combos) and focus won't move. Listen in the **capture phase** (the `true` above), `preventDefault` + `stopPropagation`, or use xterm's `attachCustomKeyEventHandler` to return `false` for your shortcuts so xterm never sees them (chapter 7). This "who eats the keystroke first" arbitration is a running theme wherever app shortcuts meet a terminal.

---

## 10.10 Tying it back to the object model

Zoom out. Everything in this chapter has been operating on one field of one object:

```
Window
 └─ Workspace
     ├─ layout: PaneNode  ← ★ THE TREE this whole chapter edits (split/close/resize/render)
     └─ …status, cwd, git…
         └─ (leaves) Pane
             └─ surfaces: Surface[]  ← each leaf's tab bar + terminals  (chapter 8)
                 └─ Panel (Terminal)
```

`splitPane`, `closePane`, and `setSizesAtPath` are pure functions from `Workspace.layout` to a new `Workspace.layout`. `LayoutView` renders that field, and every leaf it reaches hands off to chapter 8's `Pane` — so this chapter owns the _tiling_, and chapter 8 owns _what's inside each tile_. Clean seam.

And the mutations don't originate in one place — they converge on main from several sources, which is the whole reason main is the single source of truth (chapter 8):

```
WHO ASKS TO CHANGE THE LAYOUT                    THE ONE PLACE IT CHANGES        WHAT FOLLOWS
──────────────────────────────────              ────────────────────────        ──────────────────────
keyboard: Ctrl+Shift+D → "split"    ─┐
close button / Ctrl+Shift+W → "close" ├─► window.api.layout.*(intent)  ─► main mutates Workspace.layout
divider drag → "resize" (debounced)   │        (renderer → IPC, ch 4/8)      via splitPane / closePane /
socket: surface.split / surface.focus ┘        (external automation, ch 11)   setSizesAtPath  (this chapter)
                                                                                        │
                                                          webContents.send("workspace:update", snapshot)
                                                                                        ▼
                                                            renderer mirror updates → LayoutView re-renders
                                                                                        │
                                                              debounced serialize → session.json  (ch 13)
```

Trace one path to make it concrete. An agent script runs `shepherd new-split right` inside a pane. The CLI sends `surface.split { direction: 'right' }` over the unix socket (chapter 11). Main maps direction → `dir`/`where` with the tiny adapter below, spawns a fresh terminal pane, runs `splitPane` on that workspace's `layout`, and pushes the new snapshot. The renderer's `LayoutView` re-renders with one more leaf — and because main also debounces a write, that new split survives a restart (chapter 13). One tree, edited from three different front doors, rendered by one recursive component.

```ts
// the socket API's 4 directions → our (dir, where)  (chapter 11 → this chapter)
function fromDirection(d: 'left' | 'right' | 'up' | 'down'): {
  dir: 'row' | 'col'
  where: 'before' | 'after'
} {
  switch (d) {
    case 'right':
      return { dir: 'row', where: 'after' }
    case 'left':
      return { dir: 'row', where: 'before' }
    case 'down':
      return { dir: 'col', where: 'after' }
    case 'up':
      return { dir: 'col', where: 'before' }
  }
}
```

> **🔧 In Shepherd:** this is why the tree is the right abstraction _for our architecture specifically_. It's a plain, immutable, JSON-serializable data structure — so main can mutate it with pure functions, push it over IPC as a snapshot, and write it to disk verbatim, all without special-casing. A flat rectangle list (§10.1) would have made _every_ one of those steps harder. The layout tree isn't just an elegant way to draw splits; it's the shape that lets tiling, IPC, automation, and persistence all reuse the same object.

---

## 🧪 Checkpoint

Answer these before moving on (everything's in this chapter):

1. Why can't you store a workspace's layout as a flat list of `{x, y, w, h}` rectangles? Name the two operations that break, and say exactly what information the flat list is missing.
2. In `PaneNode`, what is a _leaf_ and what is a _split_? What does `dir: 'row'` mean geometrically, and which way does its divider run?
3. Describe the split operation as a tree transformation in one sentence. In `splitPane`, why must the function return a _new_ tree instead of pushing into `tree.children`?
4. What is the _collapse_ rule on close, and why is it necessary? Walk through what `closePane` returns when the target is a leaf, and when a split is left with exactly one child.
5. `sizes` are weights, not pixels or percentages. Why is that the right choice when the OS window can be resized? During a divider drag, why must you snapshot the sizes at pointer-down instead of reading them fresh each move?
6. You tile two terminals side by side and one renders too wide, shoving the divider off screen. What's the single most likely CSS cause, and what's the fix — at how many levels of the tree?
7. Splitting pane A opens a new terminal beside it, but A goes blank. Why does restructuring the tree remount A's terminal even with correct `key`s, and what pattern keeps A alive?
8. You bind "split" to `Ctrl-D` and nothing splits — the shell exits instead. Why? And why must `Alt+Arrow` pane-navigation be handled in the capture phase?

---

## Summary

A workspace's layout is a **tree**, not a list: leaves are `Pane`s, internal nodes are `split`s carrying a `dir` (`'row'` = side-by-side, `'col'` = stacked), a `sizes` array of relative weights, and children. That single structure stores the adjacency and nesting a flat rectangle list throws away, which is why every operation is a small, local tree edit. **Splitting** replaces one leaf with a two-child split (`splitPane` — a pure, immutable recursive walk). **Closing** prunes a leaf and _collapses_ any split left with a single child into that child (`closePane`). **Resizing** adjusts two neighbouring weights, converting a pixel drag to a weight delta against a snapshot taken at drag start, and clamping so no pane vanishes. **Rendering** is a recursive component that maps splits to nested flexboxes (`flex-direction` + `flex-grow: size` + `flex-basis: 0`) and leaves to chapter 8's `Pane` — and every flex level needs **`min-width: 0` / `min-height: 0`** or terminals refuse to shrink and blow out of their boxes (the one flexbox gotcha to memorize, straight from `REFRESHER.md` §4). Because restructuring the tree remounts subtrees — destroying terminal scrollback — persistent terminals live in a **stable registry** and are re-parented, not recreated. **Hand-roll** the tree (you own it in main, you want the CSS); lean on **allotment** only for drag polish; skip rc-dock. **Focus** is a renderer-local `focusedPaneId` that draws an inset-shadow ring, must stay married to real DOM focus on xterm's textarea, and navigates directionally via on-screen rectangle geometry — with app shortcuts carefully kept from clashing with the shell. All of it operates on exactly one field, `Workspace.layout`, mutated in main from the keyboard, the close button, a divider drag, and the socket API alike.

## Where this shows up next

- The exact `PaneNode` / `Pane` / `Surface` / `Panel` types this chapter mutates, and discriminated-union narrowing → `09-typescript-and-the-data-model.md`
- The `Pane` component every leaf renders (`SurfaceTabs` + `TerminalPane`), and _why terminals live in refs_ → `08-react-in-this-app.md`
- `resizePty` after a drag, and `FitAddon` reflowing the shell to the new size → `07-xtermjs.md` (and the pty side, `06-node-pty.md`)
- Where `surface.split` / `surface.focus` come from — automation editing this same tree over the socket → `11-the-socket-api.md`
- Serializing `Workspace.layout` to `session.json`, and why divider drags force a debounced write → `13-session-persistence.md`
- The end-to-end trace that walks a keystroke and a notification through the tiled panes → `17-how-it-all-connects.md`

## Further reading

- **react-mosaic** — a tiling window manager whose model is our leaf/split tree: https://github.com/nomcopter/react-mosaic
- **allotment** — the VS Code "Split View" engine as a React component (our pick for the drag layer): https://github.com/johnwalley/allotment
- **rc-dock** — a full dock manager, for contrast (tabs + float + panels): https://github.com/ticlo/rc-dock
- MDN — `min-width` and the `auto` default that forces the `min-width: 0` fix: https://developer.mozilla.org/en-US/docs/Web/CSS/min-width · CSS-Tricks, "Flexbox and truncated text": https://css-tricks.com/flexbox-truncated-text/
- i3's tree model — the same leaf/split idea in a tiling window manager, if you want the WM-world framing: https://i3wm.org/docs/userguide.html#_tree
- React — `createPortal`, the idiomatic way to keep a terminal mounted while re-parenting it (§10.7): https://react.dev/reference/react-dom/createPortal
