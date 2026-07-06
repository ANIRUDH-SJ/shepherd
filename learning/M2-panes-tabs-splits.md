# M2 — Many Terminals: Tabs & Split Panes (deep dive)

> **The goal of M2:** turn the single terminal from M1 into a **tiling workspace** —
> many terminals, arranged in **split panes** you can resize by dragging, with
> **per-pane tabs**. This is where the app starts to look like the cmux screenshot.

Pairs with `../textbook/` chapters `09` (data model), `10` (tiling), `08` (React).
This file explains **our M2 code**.

---

## 1. The one hard problem (and how we beat it)

Putting terminals in a *dynamically restructured* React tree has a nasty trap:
when you split a pane, the tree changes shape, and naive React would **unmount and
remount** the existing panes — which would **kill and respawn their shells**,
losing all your work. Unacceptable.

**Our fix: a flat, keyed "pane layer."** Instead of nesting pane components inside
split components, we:
1. Keep the layout as a **tree of data** (`LayoutNode`), and
2. **Compute a flat list** of panes, each with a rectangle (`computeLayout`), then
3. Render every pane as an **absolutely-positioned** element in one flat list,
   **keyed by `pane.id`**.

```
tree of DATA                          flat list of RENDERED panes
   split(row)                            ┌─────────┬───────────┐
   ├── pane A      ──computeLayout──►     │ pane A  │  pane B   │   (each <div> is
   └── split(col)                         │ 0,0     │  50,0     │    absolutely
       ├── pane B                         │ 50×100  ├───────────┤    positioned by %)
       └── pane C                         │         │  pane C   │
                                          └─────────┴───────────┘
```

Because the rendered panes are siblings in one keyed list, splitting pane A only
**adds** a new keyed entry and **repositions** the others — React never unmounts
pane A, so **its terminal keeps running**. This is the key idea of M2. (textbook/10)

---

## 2. What we added

```
src/renderer/src/
├── layout/
│   ├── types.ts          ★ Pane / Surface / LayoutNode / Rect / PlacedDivider
│   ├── tree.ts           ★ pure ops: split/close/addSurface/resize + computeLayout
│   └── tree.test.ts      ★ 21 headless assertions (run: npm test)
├── state/
│   └── workspaceReducer.ts ★ the reducer: actions → new tree
├── components/
│   ├── Workspace.tsx      ★ owns state; renders the flat pane layer + dividers + shortcuts
│   ├── PaneView.tsx       ★ one pane: tab bar + stacked terminals
│   ├── TabBar.tsx         ★ per-pane tabs + split/close controls
│   ├── TerminalHost.tsx   ★ one terminal (was TerminalView), multi-instance aware
│   └── Divider.tsx        ★ draggable split boundary
├── App.tsx                ~ renders <Workspace/> + shortcut legend
└── App.css               ~ pane / tab / divider styles
```
`TerminalView.tsx` from M1 was replaced by `TerminalHost.tsx`.

---

## 3. The data model (`layout/types.ts`)

```
LayoutNode = { type:'pane', pane }                         ← a leaf
           | { type:'split', id, direction, sizes[], children[] }  ← an internal node
```
- **`Surface`** = a tab (in M2, one surface == one terminal, so its id is the pty id).
- **`Pane`** = a leaf holding `surfaces[]` + `activeSurfaceId`.
- **`direction`**: `'row'` = children left↔right (vertical divider); `'column'` =
  top↕bottom (horizontal divider). **`sizes`** are fractions that always sum to 1.

This is the M2 slice of the full `Window→Workspace→Pane→Surface→Panel` model
(FEATURES.md Part 1); workspaces/windows arrive in M3.

---

## 4. The pure engine (`layout/tree.ts`) — testable, no React

Every function takes a tree and returns a **new** tree (immutable):
- **`splitPane(tree, paneId, dir, newPane)`** — replaces the leaf with a
  `[oldPane, newPane]` split (50/50).
- **`closePane(tree, paneId)`** — removes a leaf and **collapses** the parent
  (a split with one child becomes that child); renormalizes sizes.
- **`addSurface` / `closeSurface` / `setActiveSurface`** — tab operations.
- **`resizeSplit(tree, splitId, index, deltaFraction)`** — moves a boundary,
  **clamped** so no pane drops below 10%.
- **`computeLayout(tree)`** — walks the tree assigning each pane a `%` `Rect` and
  each boundary a `PlacedDivider` (with the geometry the divider needs to drag).

> **🔧 Why this is a separate, pure file:** it has **no React and no side effects**,
> so we can **test the tricky geometry headlessly**. `tree.test.ts` runs 21
> assertions with `npm test` (via `tsx`) — the one part of M2 we can verify without
> opening a window. Splitting the pure logic out is what made that possible.

---

## 5. The reducer (`state/workspaceReducer.ts`)

Holds `{ root, activePaneId }`. Each action maps to a tree op:

| Action | Effect |
|---|---|
| `split` | `splitPane` + focus the new pane |
| `closePane` | `closePane` (but never removes the **last** pane) + reselect active |
| `newSurface` / `closeSurface` | add/remove a tab; closing a pane's last tab closes the pane |
| `setActiveSurface` / `setActivePane` | focus |
| `resize` | `resizeSplit` from a divider drag |

Pure and predictable — the whole app state is one tree + one id.

> **⚠️ Gotcha (hit & fixed):** the reducer must be **pure**. New terminals are
> minted by action creators (`splitAction` / `newSurfaceAction`) in the event
> handlers, **not** inside the reducer. React StrictMode double-invokes reducers in
> dev to catch impurity — minting there numbered every new terminal *twice* (the
> "Terminal 1 → 3 → 5" bug). For the same reason the initial state is computed once
> at module load, not via a double-invoked lazy initializer.

---

## 6. The components

- **`Workspace`** — calls `computeLayout(root)` (memoized), renders the flat
  `.pane-layer`: a `PaneView` per pane (keyed by `pane.id`) + a `Divider` per
  boundary. Also installs the keyboard shortcuts.
- **`PaneView`** — one pane, absolutely positioned via inline `left/top/width/height`
  `%`. Contains the `TabBar` and, in `.pane-body`, **every** surface's
  `TerminalHost` (only the active one is `display:block`; the rest are hidden but
  **still alive**, so switching tabs keeps their shells running). `onMouseDownCapture`
  sets the active pane (capture so it works even though xterm handles mousedown).
- **`TabBar`** — tabs + `+` (new tab) + split-right / split-down / close-pane
  buttons. Each control calls `preventDefault`/`stopPropagation` so it doesn't
  reach the terminal.
- **`TerminalHost`** — the M1 terminal, now multi-instance: keyed by `surfaceId`,
  it **skips refitting while hidden** (0×0) and **refits + focuses when it becomes
  active**. Created on mount, killed on unmount (which now only happens when a tab
  or pane is actually closed).
- **`Divider`** — on drag, converts pixel movement to a **fraction of the split's
  pixel length** and dispatches incremental `resize` deltas:
  ```
  deltaFraction = (mouseΔ px) / (split length along the drag axis, in px)
  ```
  The split's pixel length = `splitExtentPct/100 × layerSize`, measured once at
  drag start.

---

## 7. Keyboard shortcuts (and why `Ctrl+Shift`)

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+D` | split right |
| `Ctrl+Shift+E` | split down |
| `Ctrl+Shift+T` | new tab |
| `Ctrl+Shift+W` | close tab / pane |

> **⚠️ Gotcha we designed around:** we can't use plain `Ctrl+<key>` — a terminal
> needs those (e.g. `Ctrl+C` interrupt, `Ctrl+D` EOF). So the app uses
> `Ctrl+Shift+…`, and the handler runs in the **capture phase** (`addEventListener(…,
> true)`) so it intercepts the key **before** xterm sees it, and only then
> `preventDefault`s. Unmatched keys flow through to the terminal untouched.

---

## 8. What's intentionally minimal / deferred

- **Repeated splits nest** (binary), so 3 side-by-side panes end up 50/25/25 rather
  than even thirds. Functional; "add to existing same-direction split" is a later polish.
- **No dragging tabs between panes**, **no directional focus nav** (Alt+arrows) yet.
- **Sidebar is still a placeholder** — it (and its own resize handle, reusing the
  Divider logic) becomes real in **M3**.
- **No WebGL renderer** yet (M6 perf pass).
- **Titles are generic** ("Terminal N") — live titles from the shell come later.

---

## 9. How to run it & what to try

```bash
npm run dev
```
- Split with the pane buttons or `Ctrl+Shift+D` / `Ctrl+Shift+E`.
- Drag the **dividers** between panes to resize.
- `Ctrl+Shift+T` for a new **tab** in the focused pane; click tabs to switch.
- Run something long in one pane, split, run something else — **both keep running**
  (that's the flat-layer win from §1).
- Close panes/tabs with the `×` buttons or `Ctrl+Shift+W`; the last one is protected.

Also try `npm test` — the headless layout assertions.

---

## 🧪 Checkpoint

1. Why would a *nested* React tree of panes be dangerous for terminals, and how does
   the **flat keyed layer** avoid it?
2. Where does layout state live, and what shape is it?
3. How does `Divider` turn a mouse drag into a resize the reducer understands?
4. Why `Ctrl+Shift+…` shortcuts instead of `Ctrl+…`, and why capture phase?
5. When you switch tabs, why doesn't the hidden terminal's shell die?

---

## Next: M3 — the workspace sidebar
We add the real **left sidebar**: multiple named workspaces, the active highlight,
and status subtitles — plus the sidebar's own **resizable width** (reusing this
milestone's `Divider` drag logic) and a **minimal socket server** to feed it.
See `../textbook/11-the-socket-api.md` and `../FEATURES.md`.
