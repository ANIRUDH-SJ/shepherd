# M5 — The Full Socket Control API (deep dive)

> **The goal of M5:** make cmux-linux **scriptable**. The M3 socket could push
> status/notifications; M5 turns it into a full control channel so an agent or
> script can **drive the whole app** over the unix socket — create workspaces,
> split panes, type into terminals, and query state.

M5 shipped as **three PRs** (+ this docs slice), each a feature branch with
kernel-style commits: workspace control → surface control → queries. Pairs with
`../textbook/11` (the socket API) and `../FEATURES.md` Part 2.

---

## 1. The shape of it

Everything speaks the M3 wire format — newline JSON `{id, method, params}` over
`/tmp/cmux-linux.sock` — and routes one of two ways:

```
 cmux <verb>  ──►  socket server (main)
                     │
      ┌──────────────┴───────────────┐
      │                              │
  answered in main            forwarded to the renderer
  (ping, capabilities,        (new-workspace, select, close,
   identify, list-workspaces)  new-split, send-text, send-key, …)
   from the workspace mirror    → dispatch an app action / terminal input
```

Queries are answered by **main** from the workspace *mirror* (the renderer syncs
its workspace list to main). Actions are **forwarded to the renderer**, which
applies them to the reducer or writes to a terminal.

---

## 2. The method surface

| Verb | Effect |
|---|---|
| `ping` | health check |
| `capabilities` | list supported methods |
| `identify` | this pane's workspace + the active one |
| `list-workspaces` | open workspaces |
| `new-workspace [--name N]` | create a workspace |
| `rename-workspace --workspace W --name N` | change or clear a workspace's custom name |
| `select-workspace --workspace W` | switch (by id or name) |
| `close-workspace --workspace W` | close |
| `new-split [right\|down]` | split the active pane |
| `send-text <text>` | type into the active terminal |
| `send-key <enter\|tab\|…>` | send a key to the active terminal |
| `set-status` / `log` / `notify` | (from M3/M4) sidebar status + flash |

---

## 3. The one design decision that makes it usable: address by name

Actions are **fire-and-forget** (reply `{ok:true}`) — the renderer applies them
asynchronously, so `new-workspace` doesn't hand back an id. That would normally
make scripting awkward. The fix: **`new-workspace` takes a `--name`, and every
command resolves `--workspace` by name.** So a script never needs a round-trip id:

```bash
cmux new-workspace --name build
cmux select-workspace --workspace build
cmux send-text "npm run build"
cmux send-key enter
```

Renaming uses the same address-by-name rule, but keeps the target and replacement
separate: `--workspace` identifies the current workspace and `--name` supplies its
new label. Main resolves the old id/name before forwarding the normalized new name:

```bash
cmux rename-workspace --workspace build --name "build and test"
```

An empty `--name ""` removes the custom label, so the sidebar falls back to its
positional `workspace N` display. The renderer changes only metadata; the layout,
PTYs, cwd, status, and session identity stay intact.

### The mirror race (and the retry)
There's a subtlety: the renderer creates the workspace, then syncs its list to
main — a beat later. A back-to-back `select-workspace --workspace build`
immediately after `new-workspace` could miss it. So **`resolveWorkspaceRetry`
polls the mirror briefly (~500 ms)** when a name/id was given before erroring, and
the error names the workspace it couldn't find. *(Found in code review — see below.)*

---

## 4. send-key translation

`send-key` maps a key name to the terminal escape sequence the shell expects
(`enter → \r`, `up → \x1b[A`, …) and writes it to the active surface's pty via the
existing `window.api.terminal.input`. Key names are matched **case-insensitively**
(`Enter` == `enter`).

---

## 5. Hardened by code review (Copilot, PRs #6/#7)

Three fixes worth noting — this is what review is *for*:
- **Mirror race → brief retry** on workspace resolution (§3), with a workspace-named error.
- **`send-key` case-sensitivity** → key names lowercased + trimmed.
- **No payload validation** → `send-text`/`send-key` reject an empty text/key with
  an error instead of a silent `{ok:true}`.

---

## 6. What's intentionally deferred

- **Round-trip results** for actions (e.g. `new-workspace` returning the new id).
  The name-addressing pattern covers most scripting without it.
- **`focus` by id**, and richer queries (`sidebar-state`, `list-status`, …).
- **send-text/send-key to a specific surface id** (currently the active one).

---

## 7. Try it

With the app running (`npm run dev`), from any pane:
```bash
cmux capabilities                 # → the method list
cmux identify                     # → this pane's workspace + the active one
cmux new-workspace --name demo
cmux rename-workspace --workspace demo --name "demo agent"
cmux send-text "echo hello from a script"
cmux send-key enter
```
The `demo` workspace appears, and the command runs in its terminal — driven
entirely over the socket.

---

## 🧪 Checkpoint

1. Which methods are answered in main vs forwarded to the renderer, and why?
2. Why can a script create-then-target a workspace without a round-trip id?
3. What race does `resolveWorkspaceRetry` fix, and how?
4. How does `send-key enter` end up as a carriage return in the shell?
5. What does `send-text` do now if you give it no text (after the review fix)?

---

## Next: M6 — polish & packaging
The finish line: a theming pass to match cmux, settings, and packaging as an
AppImage/.deb so others can install it. See `../ROADMAP.md` M6 and `../textbook/15`.
