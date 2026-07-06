# Bug 05 — Workspace/terminal numbers skip after close

**Milestone:** M3 (workspaces) · **Found by:** user report · **Status:** Fixed

## Symptom

Open a workspace, close it, open another → the new one is numbered **wrong**: e.g.
you had `main` + `workspace 2`, closed `workspace 2`, made a new one, and got
`workspace 3` instead of reusing `2`. Same behaviour for terminal ("Terminal N")
numbers.

> Note: this is **different** from Bug 03. Bug 03 was a ×2 *jump* (StrictMode
> impurity). This is a *gap after close* — a monotonic counter that never reclaims
> freed numbers.

## How we debugged it

We'd already made numbering StrictMode-safe in Bug 03, so this wasn't a ×2. Tracing
how names were assigned:

```ts
let wsCounter = 0            // module-level, only ever increments
export function makeWorkspace(name?) {
  wsCounter += 1
  return { name: name ?? `workspace ${wsCounter}`, … }
}
```

A monotonic counter never goes *down*. Close `workspace 2` and the counter is still
at 2, so the next create is `3`. The number `2` is gone forever → a visible gap.

## Root cause

**Numbering by an ever-increasing counter** instead of by what's actually in use.
Closing an item frees its number, but the counter doesn't know that.

## The fix (after one wrong turn)

**First attempt:** compute the *lowest-free* number and reuse it — close `2`, and the
next new item takes `2` again. That killed the gaps, but it was the **wrong
behaviour**: the actual ask was for the *remaining* items to **renumber** (close
`Terminal 2` → the old `Terminal 3` *becomes* `2`; a new one becomes the last number).

**What shipped — positional numbering, derived at render, nothing stored:**

```ts
// WorkspaceView — the k-th surface in tree order is "Terminal k"
const surfaceNumbers = useMemo(() => {
  const m = new Map<string, number>()
  listSurfaceIds(workspace.root).forEach((id, i) => m.set(id, i + 1))
  return m
}, [workspace.root])
```

Workspaces work the same way: the label is `workspace <index+1>` by sidebar position.
We **deleted the stored `title` field, the `lowestFreeName` helper, and the counters
entirely** — the number is now purely *derived from position*, so it's always `1..N`,
renumbers when one closes, and there's nothing to drift or double-count.

## How we prevent it now

- No stored numbers and no counters — the label is computed from position each render.
- Tests assert order/positions after a close (`tree.test.ts`, `appReducer.test.ts`).

## Lesson

Two lessons. (1) **Derive, don't store** — a "number" that should reflect current
position should be computed from position, not persisted. (2) **Confirm the exact
expected behaviour first** — "reuse the freed number" and "renumber the rest" both
remove gaps but are different; building the wrong one first cost a round-trip.
