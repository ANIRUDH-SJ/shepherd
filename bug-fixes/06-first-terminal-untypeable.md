# Bug 06 — First terminal not typeable on launch

**Milestone:** M3 (workspaces) · **Found by:** user report · **Status:** Fixed

## Symptom

After `npm run dev`, the very first terminal wouldn't accept input — you couldn't
type anything into it. (Terminals worked fine in M1/M2, so something in M3 exposed it.)

## How we debugged it

`TerminalHost` creates a real shell in a `useEffect` on mount and kills it on unmount.
Under **React StrictMode**, dev intentionally does **mount → unmount → mount** for
every component. So each terminal ran:

```
mount:    create pty (id=S)        // ipcRenderer.invoke('terminal:create')
cleanup:  dispose pty (id=S)       // ipcRenderer.send('terminal:dispose')
mount:    create pty (id=S) again  // ipcRenderer.invoke('terminal:create')
```

Here's the trap: `create` goes over the **`invoke`** channel and `dispose` over the
**`send`** channel — *different IPC channels have no ordering guarantee relative to
each other.* So in the main process the messages could be handled as:

```
create(S) → spawn pty1
create(S) → kill pty1, spawn pty2      // the recreate
dispose(S) → kill pty2, delete         // ← arrives LAST → no shell left
```

Result: a terminal wired to a shell that **no longer exists** → nothing to type into.
M1/M2 got lucky with timing; M3's heavier initial mount (sidebar, workspace sync +
socket subscriptions) shifted the timing enough to expose the race.

## Root cause

**StrictMode's dev double-mount + an imperative async resource.** A pty is an external
process managed over async IPC on two channels; the mount/cleanup/mount cycle created
a create/dispose/create sequence that could reorder and leave the shell dead.

## The fix

Turn **StrictMode off** for this app:

```tsx
// main.tsx — was <React.StrictMode><App/></React.StrictMode>
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
```

One clean mount → one live, focused, typeable shell. This is safe here because our
reducers are already **pure** (Bugs 03 & 05), which is most of what StrictMode checks
— so we lose very little by dropping it, and we gain correct terminal lifecycles.

## Why not "fix" it and keep StrictMode?

You *could* make create/dispose ordering-safe (e.g. sequence them on one channel, or
ignore a dispose for an id that was just recreated). But StrictMode's double-mount of
a real OS process is wasteful (spawns+kills a shell on every mount) and fiddly to make
race-proof. For an app whose whole job is managing imperative terminal resources,
disabling StrictMode is the pragmatic, common choice.

## How we prevent it now

- StrictMode stays off (documented in `main.tsx` with the reason).
- Purity is enforced by design (pure reducers + action creators), independent of
  StrictMode.

## Lesson

StrictMode is great for catching *pure-state* bugs (Bug 03), but its double-mount
fights **imperative external resources** (sockets, child processes, ptys). Know when
to keep it (fix the impurity) vs. when to drop it (the resource can't be made
double-mount-safe cheaply).
