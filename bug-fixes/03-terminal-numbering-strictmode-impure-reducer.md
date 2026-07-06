# Bug 03 — Terminal numbers jump 1 → 3 → 5

**Milestone:** M2 (panes/tabs/splits) · **Found by:** user report · **Status:** Fixed

## Symptom

Splitting a pane or adding a tab produced terminals numbered **1, 3, 5, …** —
skipping every other number.

## How we debugged it

The tell was the **exact ×2 pattern**. In React, a number doubling on every action
almost always means **StrictMode is double-invoking an impure function**. React's
`<StrictMode>` deliberately calls **reducers, initializers, and render** *twice* in
development to flush out code that isn't pure.

So the question became: *what impure thing runs inside our reducer?* Answer: it
**minted and numbered** the new terminal:

```ts
// workspaceReducer — WRONG: impure (increments a module counter + generates a uuid)
case 'newSurface':
  return { ...state, root: addSurface(state.root, action.paneId, makeSurface()) }
//                                                              ^^^^^^^^^^^^^ side effect
```

`makeSurface()` did `termCounter += 1`. StrictMode ran the reducer twice → `+2`.

## Root cause

**An impure reducer.** Reducers must be pure functions of `(state, action)`. Ours
performed a side effect (a counter increment + random uuid) *inside* itself, so
StrictMode's intentional double-call double-counted.

## The fix

Move the minting **out** of the reducer into **action creators** called from event
handlers (which run exactly once — StrictMode does *not* double-invoke event
handlers):

```ts
// action creator — minting happens here, in the handler, once
export function newSurfaceAction(paneId: string): WorkspaceAction {
  return { type: 'newSurface', paneId, surface: makeSurface() }
}

// reducer — now PURE: it just inserts what it was handed
case 'newSurface':
  return { ...state, root: addSurface(state.root, action.paneId, action.surface) }
```

The initial state was likewise moved to a **module-load constant** instead of a
StrictMode-double-invoked lazy initializer.

## How we prevent it now

- Reducers are pure; all minting lives in action creators.
- (Later, Bug 05 replaced counters entirely with state-derived *lowest-free*
  numbering — even more robust.)

## Lesson

**A value doubling under `<StrictMode>` = an impurity.** Don't disable StrictMode to
"fix" it — it's pointing at a real bug. Make the code pure. (Sometimes, though, the
right call *is* to disable StrictMode — see Bug 06, where the impurity is an
unavoidable imperative resource.)
