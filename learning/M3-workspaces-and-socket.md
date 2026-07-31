# M3 — Workspaces & the Socket API (deep dive)

> **The goal of M3:** add the **workspace sidebar** — cmux's signature. Multiple
> named workspaces (each with its own tiled terminals from M2), a live **status
> subtitle** per workspace, **notification markers**, a **resizable/collapsible**
> sidebar — and, underneath it, the **socket server** that lets agents drive that
> sidebar from a terminal. This is the milestone that makes it _feel_ like cmux.

Pairs with `../textbook/` chapters `11` (socket API), `12` (notifications), `09`
(data model), `10` (tiling), `05` (preload), `06` (env injection).

---

## 1. Two halves

M3 has a **UI half** (multiple workspaces + the sidebar) and a **backend half**
(the socket server that feeds it). The magic is how they connect:

```
 an agent in a pane            MAIN process                    RENDERER
 ───────────────────           ─────────────                   ────────
 shepherd set-status "building"  →  socket server  →  IPC        →  appReducer
   (bin/shepherd, over the           (net, JSON)     socket:command   setStatus
    unix socket)                 resolve wsId                  →  Sidebar re-renders
                                                                  (subtitle updates)
```

That's "Loop C" from `../textbook/01` and `/17`, finally real.

---

## 2. What we added

```
src/
├── main/
│   ├── socket.ts            ★ the unix-socket server (the backbone)
│   ├── pty.ts               ~ inject SHEPHERD_* env into each pane
│   └── index.ts             ~ start/stop socket, mirror workspaces
├── shared/ipc.ts            ~ + socket channels/types, + workspaceId on terminals
├── preload/index.ts         ~ + window.api.socket (sync + onCommand)
└── renderer/src/
    ├── state/
    │   ├── appReducer.ts     ★ AppState = workspaces[] + activeWorkspaceId (+ test)
    │   └── appReducer.test.ts★ headless assertions (npm test)
    ├── components/
    │   ├── Sidebar.tsx       ★ the workspace list
    │   └── WorkspaceView.tsx ★ the M2 pane layer, now controlled (per workspace)
    └── App.tsx               ~ app shell: sidebar + workspace stack + socket wiring
bin/shepherd                      ★ the CLI client agents call
```

---

## 3. The UI half — multiple workspaces

### `state/appReducer.ts`

State is now **two levels**:

```
AppState = { workspaces: Workspace[], activeWorkspaceId }
Workspace = { id, name, cwd, root, activePaneId,   // ← M2 state, per workspace
              status, unread, attention }           // ← sidebar metadata
```

- **Pane actions delegate down:** a `{ type:'pane', workspaceId, action }` runs the
  **pure M2 `workspaceReducer`** on just that workspace's `{ root, activePaneId }`.
  So all of M2 is reused unchanged — one workspace's splits never touch another's.
- **Same purity rule as M2:** the reducer never mints workspaces; `createWorkspaceAction()`
  does that in the event handler (StrictMode-safe).
- Selecting a workspace **clears its unread/attention** (you're looking at it now).

> **⚠️ Gotcha (hit & fixed):** workspace + terminal numbers are **positional** —
> derived from position at render time (the k-th terminal in tree order is
> "Terminal k"; workspaces are numbered by sidebar position), **not stored**. So
> closing "Terminal 2" makes the old "Terminal 3" _become_ 2 — always 1..N, no gaps.
> (See `bug-fixes/05` for the wrong-turn we took first.) Also: **React StrictMode is
> OFF** (`main.tsx`) — its dev double-mount created→disposed→recreated each pty over
> async IPC, which could race and leave the **first terminal dead/untypeable**.

### `WorkspaceView.tsx` + the "keep-alive" trick

`App` renders **every** workspace's `WorkspaceView` at once; only the active one is
`display:block`. So switching workspaces **keeps every workspace's shells running**
— exactly like tabs within a pane (M2). Hidden terminals skip refitting (0×0) and
refit when shown (the `ResizeObserver` in `TerminalHost`).

### `Sidebar.tsx`

Each row = name + status subtitle, with an **active highlight**, an **unread dot**,
and an **attention flash** (a CSS `@keyframes` ring). Plus new/close workspace. The
sidebar is **drag-resizable** (a pixel-based handle, same idea as M2's `Divider`)
and **collapsible** (`Ctrl+Shift+B`).

---

## 4. The backend half — the socket server

### `main/socket.ts`

A `net` server on a **unix socket** (`/tmp/shepherd.sock`, override
`SHEPHERD_SOCKET_PATH`) speaking **newline-terminated JSON** `{id, method, params}`:

| method               | effect                                     |
| -------------------- | ------------------------------------------ |
| `ping`               | health check                               |
| `list-workspaces`    | returns open workspaces                    |
| `set-status` / `log` | set a workspace's subtitle                 |
| `notify`             | flash the workspace + fire a desktop toast |

Two things worth understanding:

- **Message framing (the classic socket gotcha):** one `data` event may hold a
  partial or several JSON lines, so we **buffer and split on `\n`** (textbook/11).
- **The mirror pattern:** the workspace list lives in the _renderer_, but the socket
  server (in _main_) needs it to resolve `--workspace <id|name>` and to default to
  the active one. So the renderer **mirrors** its workspaces to main on every change
  (`window.api.socket.syncWorkspaces`). Main keeps a read-only copy. Incoming
  commands are resolved against it, then routed to the renderer to apply.

### Env injection (`main/pty.ts`)

Every pane's shell gets `SHEPHERD_WORKSPACE_ID`, `SHEPHERD_SURFACE_ID`, `SHEPHERD_SOCKET_PATH`,
and `<cwd>/bin` on `PATH`. So when you run `shepherd set-status …` **inside** a pane, it
knows which workspace it belongs to and how to reach the app — no flags needed.

### `bin/shepherd` (the CLI)

A tiny Node client: parse args → connect to the socket → send one JSON line → print
the reply. It defaults `--workspace` to `$SHEPHERD_WORKSPACE_ID`. This is what an agent
hook (e.g. Claude Code's `~/.claude/settings.json`) shells out to.

---

## 5. How we verified without a GUI

- **`appReducer.test.ts`** — 12 headless assertions: create/select/close workspace,
  attention set + cleared on select, a pane split hits only the target workspace.
- **A CLI/protocol test** — ran `bin/shepherd` against a mock socket server and asserted
  it sends the right JSON (status text + `SHEPHERD_WORKSPACE_ID`), round-trips `ping`, and
  prints `list-workspaces`. (Caught a fun self-deadlock in the _test_ first: a
  synchronous child spawn blocked the mock server's own event loop — fixed by
  spawning async.)

The full agent→sidebar loop needs the running app — that's your smoke test (§7).

---

## 6. What's intentionally minimal / deferred

- **`log` just sets the status** for now (no scrollable log panel yet).
- **No OSC auto-notifications** (agents emitting escape codes) — that's **M4**.
- **No session persistence** (restore workspaces/panes on relaunch) — **M4**.
- **`PATH` injection assumes dev** (`<cwd>/bin`); packaging wires it properly in M6.
  Fallback: run `node bin/shepherd …` with `SHEPHERD_SOCKET_PATH` set.
- **Rename workspace** and **directional focus nav** are later polish.

---

## 7. How to run it & what to try

```bash
npm run dev
```

- **New workspace**: the `+` in the sidebar or `Ctrl+Shift+N`. Switch by clicking;
  each keeps its own terminals **running** in the background.
- **Resize** the sidebar by dragging its right edge; **collapse** with `Ctrl+Shift+B`.
- **Drive the sidebar from a terminal** — in any pane, run:
  ```bash
  shepherd set-status "building the app…"     # → that workspace's subtitle updates
  shepherd notify --title Deploy --body "done"  # → the workspace flashes + a desktop toast
  shepherd list-workspaces
  ```
  (If `shepherd` isn't found on `PATH`, use `node bin/shepherd …` — `SHEPHERD_SOCKET_PATH` is
  already set in the pane.)
- Switch to another workspace and watch the flagged one **flash** in the sidebar
  until you visit it.

Also: `npm test` runs the layout + app-reducer suites.

---

## 🧪 Checkpoint

1. How does one workspace's split avoid touching another workspace's terminals?
2. Why does switching workspaces NOT kill the other workspaces' shells?
3. The socket server is in _main_, but workspaces live in the _renderer_. How does
   the server resolve `--workspace` — and why the "mirror"?
4. What does env injection put into each pane, and why does `shepherd set-status` work
   with no `--workspace` flag inside a pane?
5. What's message framing, and why do we buffer on `\n`?

---

## Next: M4 — agents & persistence

We wire **real agent hooks** (Claude Code → `shepherd notify`), add **OSC 9/99/777**
auto-detection so _any_ program can raise the sidebar, and add **session restore**
(reopen your workspaces/panes/cwds on relaunch). See `../textbook/12` and `/13`.
