# Chapter 8 — React in This App

> **What you'll learn**
> - The exact component tree of cmux-linux, from `App` down to the `<div>` that xterm.js draws into
> - Which hooks this app leans on (`useState`, `useEffect`, `useRef`) and the *specific* job each one does here
> - Why the xterm.js `Terminal` **must** live in a ref, never in state — the single most important React decision in the whole renderer
> - How the renderer *mirrors* the main process's workspace tree instead of owning it (source-of-truth lives in main)
> - The "props-down / events-up" wiring of the sidebar and panes, and how a recursive component renders the split tree
> - Two worked examples you'll basically ship: a `useWorkspaces()` hook and a `Sidebar` component
> - The four React mistakes that will actually bite you here (stale closures, wrong deps, missing keys, leaked listeners)
>
> **Prerequisites:** `07-xtermjs.md` (you need to know what a `Terminal` object is and how `.open()`, `.write()`, `.onData()` work). A working knowledge of React hooks is assumed — `REFRESHER.md` §1 is the 5-minute warm-up. This chapter does **not** re-teach `useState`; it teaches how *this* app uses it.

---

## 8.1 The renderer is a React app that mirrors a backend

Everything visible in cmux-linux is React: the sidebar, the tabs, the tiled panes, the terminals-inside-panes. But the renderer is an unusual React app in two ways, and both shape every pattern in this chapter:

1. **It doesn't own its own data.** The real workspace tree — every `Workspace`, every `Pane`, every split — lives in the **main process** (chapter 3). The renderer holds a *copy* that it keeps fresh by listening for `workspace:update` pushes over IPC (chapter 4). React here is a *view* of a backend, much closer to a Redux app whose store lives in another process than to a typical CRUD frontend.

2. **It embeds a non-React beast.** xterm.js owns its own DOM subtree and its own `<canvas>` (or WebGL context). React cannot "render" terminal output — it can only mount the *box* xterm paints into, then get out of the way. Half of this chapter is about drawing that boundary correctly.

Hold those two facts in your head. When we get to "why a ref, not state," both of them are the reason.

> **🔧 In cmux-linux:** the mental model from chapter 1 — *main = backend, renderer = frontend, IPC = the API* — is literally the React architecture. Your components are the frontend of a client/server app where the "server" happens to be the same executable running in a different process.

---

## 8.2 The component tree

Here is the whole renderer as a tree. Memorize the shape; the rest of the chapter walks it top to bottom.

```
App                                  ← root: owns the "mirror" of main's state
├─ Sidebar                           ← the left list of workspaces
│   └─ WorkspaceRow  × N             ← one per Workspace; click → onSelect(id)
│        ├─ name + status subtitle
│        └─ ring / unread badge
└─ MainArea                          ← shows ONLY the active workspace
    └─ PaneTree  ◄──── recursive ────┐   walks workspace.layout (a PaneNode)
         │                           │
         ├─ if node.kind === 'split' │   renders each child in its OWN PaneTree ─┘
         │                           
         └─ if node.kind === 'leaf' → Pane
                                       ├─ SurfaceTabs        ← per-pane tab bar (the "surfaces")
                                       └─ TerminalPane × N   ← one per surface
                                            └─ <div ref={hostRef} />
                                                 └─ xterm.js draws its canvas HERE
```

Read it against the object model you learned in chapter 1 and will formalize in `09-typescript-and-the-data-model.md`:

| Object-model level | Renders as | Component |
|---|---|---|
| `Window` | the whole window | `App` |
| `Workspace` (list) | the left list | `Sidebar` → `WorkspaceRow` |
| `Workspace` (active) | the right area | `MainArea` |
| `PaneNode` (the split tree) | the tiling | `PaneTree` (recursive) |
| `Pane` | one tiled rectangle | `Pane` |
| `Surface` | a tab in that rectangle | `SurfaceTabs` |
| `Panel` (terminal) | the terminal itself | `TerminalPane` → xterm.js |

Two things about this tree are non-obvious and worth flagging now, because they drive the code:

- **`PaneTree` is recursive.** A workspace's layout is a *tree* of splits, so the component that renders it calls itself. We cover the shape here and defer the geometry (sizes, drag-to-resize, focus math) to `10-tiling-and-layout.md`.
- **`TerminalPane` is a leaf that hosts a foreign object.** It's the boundary between "React world" and "xterm world." Everything above it is ordinary React; below it is a hand-managed imperative library. That boundary is §8.4–8.5.

---

## 8.3 The three hooks that do all the work (and *why* each)

You will use maybe five hooks in this entire app, but three carry the weight. The point of this section isn't *what they do* (you know that) — it's *which job each one is doing in cmux-linux*, because the same three hooks are pulling three very different loads.

### `useState` — the *control-plane* state

`useState` holds anything that, when it changes, should **redraw UI**: the list of workspaces, which one is active, whether the sidebar is collapsed, which pane is focused. These changes are **rare and cheap** — a workspace switch, a status pill flipping to red, a new notification. Firing a re-render for them is exactly what React is for.

```tsx
const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
const [activeId, setActiveId]     = useState<string | null>(null);
const [collapsed, setCollapsed]   = useState(false);   // pure UI state, lives only here
```

Notice the split: `workspaces`/`activeId` are a **mirror of main**, while `collapsed` is **pure renderer-local UI state** that main neither knows nor cares about. Keeping that distinction clear stops you from over-syncing trivial UI toggles to the backend.

### `useEffect` — subscribe to pushes, and *clean up*

Every stream of data coming *from* main into the renderer is subscribed to inside a `useEffect`, and every such subscription **must** be torn down in the effect's cleanup return. This is not optional politeness — a leaked IPC listener means every remount stacks another handler, and soon one `pty-data` push writes to the terminal three times.

```tsx
useEffect(() => {
  const off = window.api.onWorkspaceUpdate(handleSnapshot); // subscribe
  return () => off();                                        // ← cleanup, EVERY time
}, []);
```

The cleanup return is the single most-forgotten line in the whole renderer. We'll hammer it again in §8.10.

### `useRef` — hold things React shouldn't re-render for

`useRef` gives you a mutable box whose `.current` you can change **without triggering a render**. In this app it does two jobs:

1. **Hold a DOM node** so we can hand it to a non-React library: `hostRef.current` is the `<div>` we pass to `term.open()`.
2. **Hold a long-lived object across renders** that must *not* be re-created: the xterm `Terminal` instance itself, the `FitAddon`, a pty id, or a "latest value" mirror used to dodge stale closures (§8.10).

```tsx
const hostRef = useRef<HTMLDivElement>(null); // the box xterm paints into
const termRef = useRef<Terminal | null>(null); // the xterm instance, kept alive across renders
```

That second job — *keeping xterm alive and out of React's way* — is important enough that it gets its own section.

---

## 8.4 Why xterm.js must live in a ref, not in state

This is the decision that, done wrong, makes cmux-linux feel like molasses. Take it slowly.

### The firehose problem

When a shell prints output, it doesn't arrive as one tidy string. `pty.onData` (chapter 6) fires in bursts — running `ls` on a big directory, `cat`-ing a file, or watching a build log can fire the data callback **hundreds of times per second**, each with a chunk of bytes. Every chunk has to reach the terminal on screen.

Now imagine you stored the terminal's contents in React state:

```tsx
// ❌ CATASTROPHE — do not do this
const [buffer, setBuffer] = useState("");
useEffect(() => {
  const off = window.api.onPtyData(paneId, chunk =>
    setBuffer(prev => prev + chunk)   // a setState PER CHUNK...
  );
  return off;
}, [paneId]);
return <pre>{buffer}</pre>;
```

Each `setBuffer` schedules a re-render. At a few hundred chunks a second, you're asking React to reconcile — and the browser to re-layout a growing `<pre>` — hundreds of times a second, while the string it's diffing grows without bound. You'd also have to re-implement everything xterm already does: cursor movement, colors, line wrapping, the ANSI/OSC escape codes from chapter 2. It would be slow *and* wrong.

### The fix: two separate "planes"

The insight is that terminal output should **never touch React state at all**. xterm.js already owns a `<canvas>` and knows how to paint bytes onto it efficiently. So we hand the bytes *straight to xterm* with an imperative `term.write(chunk)` call and let React sleep.

That splits the renderer into two data planes with completely different rules:

```
CONTROL PLANE  (rare, cheap → React SHOULD re-render)
   workspace:update push
        │
        ▼
   setWorkspaces(...)  ──►  React reconciles Sidebar, tabs, layout
        e.g. a status pill turns red once


DATA PLANE  (constant firehose → React must NEVER see it)
   pty-data push  ───►  term.write(chunk)  ───►  xterm's own <canvas>
        │
        └─ React is not involved. No setState. No re-render. No reconciliation.
```

The `Terminal` instance sits on the *data plane*. React's job is only to mount the `<div>` it lives in — once, when the pane appears — and to never bother it again. That is precisely what a ref is for: a place to keep an object that is **part of the DOM/imperative world, not the render world.**

### Why not even a "stable" state variable?

You might think: "fine, I won't store the *buffer* in state, but I'll store the *Terminal instance* in state so components can read it." Two problems:

1. **A `Terminal` is not render data.** Nothing about it should trigger a re-render, so putting it in state buys you nothing and invites `useEffect` deps that fire when they shouldn't.
2. **Re-creation is disastrous.** If a re-render ever caused `new Terminal()` to run again, you'd get a *second* terminal, a leaked canvas, duplicated `onData` handlers, and lost scrollback. A ref created once inside `useEffect(() => {...}, [])` is created exactly once. That guarantee is the whole point.

> **⚠️ Gotcha:** the rule "lift state up, avoid refs" that you learned for normal React is *inverted* at this boundary. xterm, a map widget, a chart, a video player — any library that owns its own DOM — belongs in a ref, driven by imperative calls inside effects. Refs aren't a smell here; they're the officially sanctioned escape hatch to non-React code.

---

## 8.5 Worked example: the `TerminalPane` component

Here is the leaf of the tree, in full. This is the crux of the chapter — read it, then read the walkthrough.

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export function TerminalPane({ paneId }: { paneId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);   // the DOM box xterm draws into
  const termRef = useRef<Terminal | null>(null);  // the xterm instance (survives renders)
  const fitRef  = useRef<FitAddon | null>(null);

  useEffect(() => {
    // --- create ONCE for this pane ---
    const term = new Terminal({ fontFamily: "monospace", fontSize: 13, cursorBlink: true });
    const fit  = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);   // hand xterm the raw DOM node from the ref
    fit.fit();                      // size the grid to the container

    termRef.current = term;
    fitRef.current  = fit;

    // --- DATA PLANE: pty output (main → renderer) written straight to xterm ---
    const offData = window.api.onPtyData(paneId, (data: string) => {
      term.write(data);            // imperative; xterm batches + paints its own canvas
    });                            // NOTE: no setState anywhere in here

    // --- keystrokes (renderer → main): xterm hands us bytes, we ship them to the pty ---
    const inputSub = term.onData((data: string) => {
      window.api.sendPtyInput(paneId, data);
    });

    // tell the pty our starting size so the shell wraps lines correctly
    window.api.resizePty(paneId, term.cols, term.rows);

    // keep the pty's size in sync when the pane is resized
    const onResize = () => {
      fit.fit();
      window.api.resizePty(paneId, term.cols, term.rows);
    };
    window.addEventListener("resize", onResize);

    // --- CLEANUP: tear EVERYTHING down (see §8.10) ---
    return () => {
      window.removeEventListener("resize", onResize);
      offData();            // remove the IPC listener (or it leaks + duplicates output)
      inputSub.dispose();   // remove xterm's onData handler
      term.dispose();       // free xterm's canvas + DOM
      termRef.current = null;
    };
  }, [paneId]);            // re-run ONLY if this component is pointed at a different pty

  return <div className="terminal-host" ref={hostRef} />;
}
```

**Walkthrough, line by line:**

- **Two refs, two jobs.** `hostRef` is the DOM node; `termRef` is the instance. We only strictly *need* `termRef` if something outside the effect must reach the terminal (e.g. a "clear" button calling `termRef.current?.clear()`); but keeping it is cheap and idiomatic.
- **Everything happens inside one `useEffect`.** Creation, subscription, and teardown are colocated so they can't drift apart. The effect body is "mount this terminal"; the returned function is "unmount this terminal." They're mirror images.
- **`term.open(hostRef.current!)`** is the handoff. React rendered the `<div>`; by the time the effect runs, `hostRef.current` is that live DOM node, and we give it to xterm. From here, xterm owns everything *inside* that div.
- **The data plane has no `setState`.** `onPtyData` → `term.write` is a straight pipe. This is the entire performance story: React never sees a single byte of shell output.
- **The deps array is `[paneId]`,** and that is a deliberate, load-bearing choice. See below.

### The `[paneId]` deps array, explained

The dependency array on this effect is the difference between a working terminal and a broken one:

- **`[]` (empty)** — the effect runs once and *never re-subscribes*. If this component is ever re-pointed at a different pty (e.g. the pane's active surface changes to another terminal) while staying mounted, you'd still be wired to the *old* `paneId`. Output would go to the wrong terminal. (We usually avoid this scenario by keying — see §8.9 — but the deps must still be honest.)
- **`[paneId]`** — when and only when `paneId` changes, React runs the cleanup (dispose the old terminal + listeners) and re-runs the effect (make a fresh terminal for the new pty). Correct.
- **`[paneId, someObject]` where `someObject` is created inline each render** — the effect re-runs *every render*, disposing and recreating the whole terminal constantly. This is the "I put too much in the deps" disaster; you'll see a terminal that flickers and loses scrollback on every parent render.

> **🔧 In cmux-linux:** notice the two IPC directions map cleanly onto Loops A and B from chapter 1. `term.onData → sendPtyInput` is **Loop A** (you type → main → shell). `onPtyData → term.write` is **Loop B** (shell prints → main → you see it). `TerminalPane` is where both loops close in the UI.

---

## 8.6 State management: main is the source of truth

Now step back up to the control plane. How does the renderer know what workspaces exist, which is active, what each one's status is?

**It does not decide.** The main process owns the authoritative workspace tree (it's the one talking to node-pty, the socket API, and the session file). The renderer holds a **mirror**, and the update flow is strictly unidirectional:

```
                 ┌─────────────────────────── MAIN (source of truth) ───────────┐
   user clicks   │  window store: Workspace[] , activeWorkspaceId               │
   a workspace   │       ▲ mutate                    │ after mutating...         │
       │         │       │                           ▼                          │
       ▼         │  handle("workspace:select")   webContents.send(              │
  window.api     │       │                          "workspace:update", snap)   │
  .selectWorkspace(id) ──┘                           │                          │
       │  (event UP to main)                         │  (push DOWN to renderer) │
       └─────────────────────────────────────────────┼──────────────────────────┘
                                                      ▼
                             renderer: setWorkspaces(snap.workspaces)
                                       setActiveId(snap.activeWorkspaceId)
                                                      │
                                                      ▼
                                             React re-renders the sidebar
```

The renderer **never mutates the tree locally as truth.** To change something, it sends an *intent* to main (`selectWorkspace(id)`), main mutates its store, main pushes the new snapshot back, and the renderer re-renders from that snapshot. This is exactly Redux's "actions in, new state out" — except the reducer runs in a different process.

Why do it pessimistically like this, waiting for the round-trip instead of updating the UI optimistically? Because early on, **consistency is worth more than the few milliseconds of latency.** There is exactly one place state changes (main), so the renderer can never disagree with the backend. Once the app is real and you find a specific interaction that feels laggy, you can add optimistic updates *there*, surgically. Doing it everywhere up front is how you get two sources of truth that drift.

### Worked example: the `useWorkspaces()` hook

All of that flow belongs in one custom hook, so components don't each re-implement the subscription. This is a hook you'll basically ship as-is.

```tsx
import { useEffect, useState } from "react";
import type { Workspace } from "../../shared/types";

interface Snapshot {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId]     = useState<string | null>(null);

  useEffect(() => {
    let alive = true; // guard: don't setState after unmount

    // 1) request/response: fetch the current snapshot once on mount
    window.api.getWorkspaces().then((snap: Snapshot) => {
      if (!alive) return;
      setWorkspaces(snap.workspaces);
      setActiveId(snap.activeWorkspaceId);
    });

    // 2) subscribe to pushes: main sends a fresh snapshot on every change
    const off = window.api.onWorkspaceUpdate((snap: Snapshot) => {
      setWorkspaces(snap.workspaces);
      setActiveId(snap.activeWorkspaceId);
    });

    // 3) cleanup: unsubscribe + neutralize the in-flight request
    return () => {
      alive = false;
      off();
    };
  }, []); // subscribe once for the app's lifetime

  // events go UP to main; main remains the source of truth
  const select = (id: string) => window.api.selectWorkspace(id);

  return { workspaces, activeId, select };
}
```

**Why it's shaped this way:**

- **Snapshot-on-mount *and* subscribe.** The push only fires on *changes*; without the initial `getWorkspaces()` fetch, a freshly opened window would show an empty sidebar until something happened to change. Fetch the current state, then listen for deltas — a very common pattern for "mirror a backend."
- **The `alive` guard.** `getWorkspaces()` is async; if the component unmounts before it resolves, calling `setWorkspaces` would warn (and waste work). The boolean flag, flipped in cleanup, makes the late resolution a no-op. (React 18 tolerates the warning, but the guard is correct and cheap.)
- **`[]` deps are correct here** because there's genuinely nothing to re-subscribe on — this hook lives for the whole app. Contrast with `TerminalPane`'s `[paneId]`, which *must* re-run when the target changes. Same hook, opposite deps, because the jobs differ.
- **`select` doesn't `setState`.** It fires an intent at main and returns. The visible change arrives moments later as a `workspace:update` push. One direction, always.

---

## 8.7 Props-down, events-up: the Sidebar

With `useWorkspaces()` in hand, the App root wires the two halves of the screen together. This is textbook "props down, events up" — the App owns the mirrored state, hands *data* down as props, and receives *intents* up as callbacks.

```tsx
function App() {
  const { workspaces, activeId, select } = useWorkspaces();
  const active = workspaces.find(w => w.id === activeId) ?? null;

  return (
    <div className="app">
      <Sidebar workspaces={workspaces} activeId={activeId} onSelect={select} />
      <MainArea workspace={active} />
    </div>
  );
}
```

The `Sidebar` is a pure presentational component — no hooks, no IPC, no state. Give it a list and a callback; it renders rows and calls back on click. That purity makes it trivial to test and reason about.

```tsx
interface SidebarProps {
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

function Sidebar({ workspaces, activeId, onSelect }: SidebarProps) {
  return (
    <nav className="sidebar">
      {workspaces.map(ws => (
        <WorkspaceRow
          key={ws.id}                       // STABLE key = ws.id, never the array index
          workspace={ws}
          active={ws.id === activeId}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function WorkspaceRow({
  workspace, active, onSelect,
}: {
  workspace: Workspace;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const status = workspace.status[0]?.label ?? "";
  return (
    <button
      className={active ? "row active" : "row"}
      onClick={() => onSelect(workspace.id)}   // event UP: just report the id
      data-attention={workspace.attention || undefined}  // CSS hook for the ring/flash
    >
      <div className="name">{workspace.name}</div>
      <div className="status">{status}</div>
      {workspace.unread && <span className="badge" aria-label="unread" />}
    </button>
  );
}
```

**What to notice:**

- **The row knows nothing.** It gets a `Workspace` and an `onSelect`. It doesn't fetch, doesn't decide what "active" means, doesn't talk to main. When clicked, it reports *its own id upward* and lets the App (via `select` → main → push) decide what happens. The row is dumb on purpose.
- **`key={ws.id}`, always.** More on why this matters more here than in most apps in §8.10.
- **`data-attention` and the `badge`** are the sidebar's whole "ring/flash + unread" story from `FEATURES.md` — driven entirely by fields on the mirrored `Workspace`, which were set by an agent through the socket API (chapter 11). React just reflects the state; the *meaning* was decided upstream.

---

## 8.8 Rendering the recursive split tree

`MainArea` shows the active workspace, and a workspace's `layout` is a `PaneNode` — a tree of splits (formalized in `09-typescript-and-the-data-model.md`). Rendering a tree calls for a component that renders itself.

```tsx
import type { PaneNode } from "../../shared/types";

function MainArea({ workspace }: { workspace: Workspace | null }) {
  if (!workspace) return <EmptyState />;   // no workspace selected yet
  return (
    <main className="main">
      <PaneTree node={workspace.layout} />
    </main>
  );
}

function PaneTree({ node }: { node: PaneNode }) {
  // BASE CASE: a leaf is a single pane
  if (node.kind === "leaf") {
    return <Pane pane={node.pane} />;
  }

  // RECURSIVE CASE: a split lays out its children, each in its own PaneTree
  const direction = node.dir === "row" ? "split split-row" : "split split-col";
  return (
    <div className={direction}>
      {node.children.map((child, i) => (
        <div key={keyOf(child)} style={{ flexGrow: node.sizes[i], flexBasis: 0 }}>
          <PaneTree node={child} />        {/* ← the component recurses */}
        </div>
      ))}
    </div>
  );
}
```

The `node.kind === "leaf"` check is TypeScript **narrowing** a discriminated union — inside that branch, TS *knows* `node` is a leaf and lets you read `node.pane`; inside the `else`, it knows it's a split and lets you read `node.children`. That pairing of a recursive tree with a discriminated union is so central it gets its own long treatment in `09-typescript-and-the-data-model.md`.

Two honest limits of this snippet, both deliberate:

- **The geometry is a placeholder.** `flexGrow: node.sizes[i]` gives proportional sizing, but real tiling needs draggable dividers, min sizes, and focus math. All of that is `10-tiling-and-layout.md`. Here we only care that the *component structure* mirrors the *data structure*.
- **`keyOf(child)`** must return a **stable** id for each child node (a pane id for leaves, a synthetic-but-stable id for splits) — never the array index, for the reasons in §8.10.

### The `Pane`: surfaces that persist across tab switches

A `Pane` holds several `Surface`s (tabs), one active at a time. The naive approach — render only the active surface — is *wrong* for terminals, and understanding why is a genuinely non-obvious, app-specific insight.

```tsx
function Pane({ pane }: { pane: Pane }) {
  return (
    <section className="pane">
      <SurfaceTabs pane={pane} />
      {/* Render EVERY surface; hide the inactive ones with CSS.
          Unmounting a terminal would dispose its xterm and lose scrollback. */}
      {pane.surfaces.map(surface => {
        const isActive = surface.id === pane.activeSurfaceId;
        return (
          <div
            key={surface.id}
            className="surface-host"
            style={{ display: isActive ? "block" : "none" }}
          >
            {surface.panel.type === "terminal" && (
              <TerminalPane paneId={surface.panel.ptyId!} />
            )}
          </div>
        );
      })}
    </section>
  );
}
```

Why render *all* surfaces and hide the inactive ones, instead of just rendering the active one?

- **Unmounting a terminal is expensive and lossy.** In a normal React app, unmounting a component is cheap and reversible. Here, unmounting `TerminalPane` runs its cleanup: `term.dispose()` destroys the xterm canvas and its **scrollback buffer in the renderer**. Switch away from a tab and back, and the terminal would be *blank* — because the shell kept printing (the pty lives in main and never paused) while its on-screen view was gone.
- **Keeping them mounted preserves the view.** With `display:none`, the xterm instance stays alive, scrollback intact, and switching tabs is instant.

There's a cost and a matching gotcha:

> **⚠️ Gotcha:** a `display:none` element has **zero width and height**. If a `TerminalPane` mounts (or gets resized) while hidden, `FitAddon.fit()` computes a `0×0` grid and the terminal renders wrong when revealed. The fix: call `fit()` **when a surface becomes visible**, not only on mount. In practice you observe visibility (or run `fit()` in the tab-switch handler) and then `resizePty` with the new dimensions. Keep this in your back pocket — it's the classic "terminal is one cell wide" bug.

(If you'd rather not pay for N live terminals per pane, the alternative is to unmount inactive ones and have **main replay recent scrollback** on re-attach — but that's real work and belongs to `13-session-persistence.md`. For v1, mount-all-and-hide is simpler and correct.)

---

## 8.9 Scaling state later: Context/reducer vs a small store

Right now, state management is: `useWorkspaces()` at the root, props threaded down. That is genuinely all you need for a while — the entire "global" state is a thin mirror of main plus a couple of UI toggles. Resist the urge to reach for a state library on day one. But you should know the two roads ahead, and when each earns its keep.

**Road A — `useReducer` + Context.** When prop-drilling `onSelect`, `onSplit`, `onFocus`, `onCloseSurface` through `MainArea → PaneTree → Pane → SurfaceTabs` starts to hurt, put the state and a `dispatch` behind a Context so deep components can reach them without threading props.

```tsx
type Action =
  | { type: "snapshot"; snap: Snapshot }
  | { type: "focusPane"; paneId: string };

function reducer(state: UiState, action: Action): UiState {
  switch (action.type) {
    case "snapshot":  return { ...state, ...action.snap };
    case "focusPane": return { ...state, focusedPaneId: action.paneId };
  }
}

const StoreCtx = createContext<{ state: UiState; dispatch: Dispatch<Action> } | null>(null);
```

A reducer fits our data unusually well, because most updates already *are* "apply this whole snapshot from main" plus a few local UI intents. The catch: a Context re-renders **every** consumer whenever the value changes — no fine-grained subscriptions. With a big pane tree and frequent status pushes, that's a lot of needless reconciliation.

**Road B — a tiny external store (e.g. Zustand).** When you measure that whole-tree re-render pain, a store with **selectors** solves it: each component subscribes to just the slice it reads, and re-renders only when *that slice* changes.

```tsx
import { create } from "zustand";

interface AppStore {
  workspaces: Workspace[];
  activeId: string | null;
  apply(snap: Snapshot): void;    // called by the ONE subscription at app root
}

export const useStore = create<AppStore>((set) => ({
  workspaces: [],
  activeId: null,
  apply: (snap) => set({ workspaces: snap.workspaces, activeId: snap.activeWorkspaceId }),
}));

// deep in the tree, no props threaded:
const activeId = useStore(s => s.activeId);   // re-renders ONLY when activeId changes
```

**The recommendation: stay on the plain-hooks road until it hurts, and let the *kind* of hurt pick the tool.** Prop-drilling annoyance → Context. Measured re-render cost on the big tree → Zustand. Not before. Two reasons this app can afford to wait:

1. **The real store already lives in main.** The renderer's state layer is deliberately a dumb cache. You don't need a heavyweight client store to manage data you don't own.
2. **Control-plane updates are rare (§8.4).** A whole-tree re-render on a *once-in-a-while* status change is cheap. The expensive thing — terminal output — already bypasses React entirely. So the usual motivation for a fancy store ("too many re-renders") mostly doesn't apply until the workspace tree gets genuinely large.

> **🔧 In cmux-linux:** premature global-state plumbing is the most likely place to over-engineer this app. The architecture is already "unidirectional data, single source of truth" *for free*, because main is the store and IPC is the dispatch. Adding Redux/Zustand on top too early just duplicates that in the renderer.

---

## 8.10 The four gotchas that will actually bite you

These aren't generic React tips — they're the specific failure modes this app's shape invites.

### 1. Stale closures in long-lived handlers

A handler you register once (in a `[]`-deps effect) closes over whatever variables existed *at that moment* and never sees later values. Classic version:

```tsx
// ❌ activeId is captured on mount and frozen forever
useEffect(() => {
  const off = window.api.onWorkspaceUpdate(() => {
    console.log("active is", activeId);  // ALWAYS the first value, even after it changes
  });
  return off;
}, []); // activeId not in deps → the closure is stale
```

You hit this the moment a subscription's callback needs to read some *other* piece of state. Two idiomatic fixes:

- **Put it in the deps** and let the effect re-subscribe (`[activeId]`) — fine if re-subscribing is cheap.
- **Mirror the value into a ref** you refresh every render, and read the ref inside the handler — the right move when you must *not* tear down the subscription (e.g. a terminal you don't want to re-create):

```tsx
const activeIdRef = useRef(activeId);
activeIdRef.current = activeId;        // refreshed on every render
useEffect(() => {
  const off = window.api.onWorkspaceUpdate(() => {
    console.log("active is", activeIdRef.current); // always current — no re-subscribe
  });
  return off;
}, []);
```

This is `useRef` doing its *second* job (§8.3): a always-current box that dodges the closure, without dragging React into a re-subscribe.

### 2. Wrong `useEffect` dependency arrays

Two directions, both painful, and `TerminalPane` makes both *loud*:

- **Too few deps** → the effect keeps stale values (the stale-closure bug above), or fails to re-wire when it should.
- **Too many / unstable deps** (an inline object or function in the array) → the effect re-runs *every render*. For a terminal, that means `dispose()` + `new Terminal()` on every parent render: flicker, lost scrollback, leaked listeners. The lint rule `react-hooks/exhaustive-deps` catches most of this; when you deliberately silence it, leave a comment saying why.

### 3. Missing or index-based `key`s

Keys matter more here than in a typical list, because a wrong key can **remount a terminal**:

```tsx
{workspaces.map((ws, i) => <WorkspaceRow key={i} ... />)}  // ❌ index key
{workspaces.map(ws     => <WorkspaceRow key={ws.id} ... />)} // ✅ stable id
```

With index keys, inserting or reordering workspaces makes React reuse the *wrong* component instances for the wrong data. In the sidebar that's a cosmetic glitch — but the same mistake on a `TerminalPane` (keyed by surface index instead of surface id) makes React think surface #2 became surface #1, unmount one terminal, and mount another. You'd `dispose()` a live terminal and lose its scrollback on an unrelated list change. **Key anything that contains a terminal by a stable, data-derived id — never by array position.**

### 4. Forgetting cleanup (leaked listeners)

Every `window.api.on*` returns an unsubscribe function. Drop it and you leak:

```tsx
useEffect(() => {
  window.api.onPtyData(paneId, d => term.write(d)); // ❌ no return → never removed
}, [paneId]);
```

Each mount (and, in dev, React 18's Strict-Mode double-mount, plus every HMR reload) stacks another listener. Symptoms: terminal output printed **twice, then three times**; steadily climbing memory; a `MaxListenersExceededWarning` in the console. The fix is always the same shape — capture the unsubscribe and return it:

```tsx
useEffect(() => {
  const off = window.api.onPtyData(paneId, d => term.write(d));
  return () => off(); // ✅
}, [paneId]);
```

> **⚠️ Gotcha:** React 18 Strict Mode *intentionally* mounts every component twice in development to smoke out exactly this bug. If your terminal shows doubled output in dev but you "didn't change anything," you almost certainly have a subscription with no cleanup. Strict Mode is doing you a favor — fix the cleanup, don't disable Strict Mode.

---

## 🧪 Checkpoint

Answer these before moving on (everything's in this chapter):

1. Trace the component path from `App` down to the exact DOM node that xterm.js paints into. Which component owns the boundary between React and xterm?
2. Terminal output can arrive hundreds of times per second. Explain, in terms of the two "planes," why that output must not go through `useState`.
3. Why is the xterm `Terminal` held in a `useRef` rather than `useState`? Give two distinct reasons.
4. `useWorkspaces()` uses `[]` deps but `TerminalPane` uses `[paneId]`. Why is each correct for its hook?
5. When the user clicks a workspace row, the sidebar doesn't change the active workspace itself. What actually happens, step by step, and why is that "pessimistic" round-trip a good default?
6. Why do we render *all* surfaces in a pane and hide the inactive ones, instead of rendering only the active surface? What new bug does that introduce, and how do you fix it?
7. You subscribe to `onWorkspaceUpdate` in a `[]`-deps effect, and the callback needs the current `activeId`. Why will it read a stale value, and what are two fixes?
8. Why is keying a `TerminalPane` by array index specifically dangerous — worse than keying a plain sidebar row by index?

---

## Summary

The cmux-linux renderer is a React app whose data lives somewhere else. The **component tree** runs `App → Sidebar[WorkspaceRow…] + MainArea → PaneTree(recursive) → Pane → SurfaceTabs → TerminalPane`, mirroring the object model level for level. Three hooks carry the app: **`useState`** holds the *control-plane* mirror of main's workspace tree (rare, cheap re-renders), **`useEffect`** subscribes to IPC pushes *and cleans them up*, and **`useRef`** holds the things React must not re-render for — chiefly the xterm `Terminal`, which lives on a separate **data plane** where shell output is piped straight to `term.write()` and never touches React state. The renderer treats **main as the single source of truth**: it renders a snapshot, sends *intents* up (`selectWorkspace`), and re-renders when main pushes `workspace:update` back down. Keep state management dead simple — plain hooks and props — until prop-drilling or measured re-render cost specifically justifies Context or a small store. And respect the four failure modes this shape invites: stale closures (fix with a ref-mirror), wrong deps arrays, index keys (which can remount and destroy a terminal), and un-cleaned subscriptions (which duplicate output and leak).

## Where this shows up next
- The recursive tiling *geometry* — sizes, draggable dividers, focus math — behind `PaneTree` → `10-tiling-and-layout.md`
- The exact TypeScript for `Workspace`, `Pane`, and the `PaneNode` discriminated union these components consume → `09-typescript-and-the-data-model.md`
- The IPC surface (`window.api`, `onWorkspaceUpdate`, `onPtyData`) these hooks call → `04-ipc-inter-process-communication.md` and `05-preload-and-context-isolation.md`
- Where a `workspace:update` push *originates* (an agent hitting the socket) → `11-the-socket-api.md` and `12-notifications-and-osc.md`
- Replaying scrollback so you *can* unmount inactive terminals → `13-session-persistence.md`
- The end-to-end synthesis of a keystroke and a notification through these components → `17-how-it-all-connects.md`

## Further reading
- React docs — "Manipulating the DOM with Refs" and "Synchronizing with Effects" (the two official guides for exactly the xterm-in-a-ref pattern): https://react.dev/learn/manipulating-the-dom-with-refs · https://react.dev/learn/synchronizing-with-effects
- React docs — "You Might Not Need an Effect" and "Reusing Logic with Custom Hooks" (context for §8.6/§8.9): https://react.dev/learn/you-might-not-need-an-effect · https://react.dev/learn/reusing-logic-with-custom-hooks
- xterm.js — using it inside a component framework: https://xtermjs.org/docs/
- Zustand — the minimal store from §8.9: https://github.com/pmndrs/zustand
