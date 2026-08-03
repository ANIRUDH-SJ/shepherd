# Shepherd — Feature Research & Implementation Map

The initial feature research used cmux documentation and its public repository,
then mapped the concepts onto Shepherd's Electron + xterm.js + node-pty + React
stack. This file now distinguishes upstream behavior from Shepherd's implemented
surface. It pairs with `ROADMAP.md`.

> **The single most important finding:** rich sidebar status is driven by a
> **socket API**. Agents push status/log/notification data over a Unix socket, and
> the app renders it. Our runtime keeps that structured path and adds bounded
> process discovery so basic agent presence no longer depends on a report.

---

## Part 1 — cmux's object model (get this right first)

cmux's real hierarchy (from its Concepts doc) is **deeper** than "tabs → panes":

```
Window
 └─ Workspace        ← a sidebar entry (what you see in the left list)
     └─ Pane          ← a split region (⌘D right / ⌘⇧D down)
         └─ Surface    ← a tab WITHIN a pane (each pane has its own tab bar)
             └─ Panel   ← the actual content: a Terminal OR a localhost Preview
```

- **Window** — an OS window; each has its own sidebar + independent workspaces.
- **Workspace** — one row in the sidebar. Carries the name, cwd, git branch, PR,
  ports, status pills, progress, and notification/unread state. Env: `SHEPHERD_WORKSPACE_ID`.
- **Pane** — a resizable split region inside a workspace (the tiling).
- **Surface** — a tab inside a pane; a pane can hold several surfaces. Env: `SHEPHERD_SURFACE_ID`.
- **Panel** — what's rendered in a surface: an xterm.js **Terminal** or a constrained
  localhost **Preview**.

**Mapping to the screenshot you shared:** the left list = _workspaces_; each big
tiled region = a _pane_; the little tab bars on top of some regions = _surfaces_;
the terminal content = a _terminal panel_.

### Our data model (React/TypeScript)

```ts
type Panel = { type: 'terminal' } | { type: 'preview'; url: string }
interface Surface {
  id: string
  panel: Panel
} // a tab
interface Pane {
  id: string
  surfaces: Surface[]
  activeSurfaceId: string
}
type PaneNode =
  | { type: 'pane'; pane: Pane }
  | {
      type: 'split'
      id: string
      direction: 'row' | 'column'
      sizes: number[]
      children: PaneNode[]
    }

interface Workspace {
  id: string
  name: string
  cwd: string
  root: PaneNode // the split tree
  activePaneId: string
  // --- sidebar metadata, all pushed via the socket API (Part 2) ---
  status: StatusPill[] // set-status
  progress?: { value: number; label?: string }
  logs: LogEntry[]
  notifications: Notif[]
  unread: boolean
  attention: boolean // drives the ring/flash
  git?: { branch?: string; pr?: { number: number; state: string } }
  ports?: number[]
}
interface Window {
  id: string
  workspaces: Workspace[]
  activeWorkspaceId: string
}
```

> **Current boundary:** terminal and localhost-preview panels ship. A preview URL is
> repeatedly validated as HTTP(S) loopback, and preview surface ids never become PTY ids.
> General browser panels and automation remain separate future work.

---

## Part 2 — The socket API (the backbone of everything)

The upstream cmux app exposes a Unix-socket JSON API. Shepherd uses the same
transport idea with its own `shepherd` CLI and identity.

**cmux's actual wire format** (we copy this):

- Upstream socket path: `/tmp/cmux.sock`
- Shepherd socket path: `/tmp/shepherd.sock`
- Shepherd override: `SHEPHERD_SOCKET_PATH`
- Messages: **newline-terminated JSON**, `{ id, method, params }` → `{ id, result }` / `{ id, error }`
  (basically JSON-RPC).

**cmux's method surface** (what we'll implement, grouped):

| Group              | Methods                                                                                | CLI examples                                              |
| ------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Workspaces         | `workspace.list` / `.create` / `.select` / `.current` / `.close`                       | `cmux list-workspaces --json`, `cmux new-workspace`       |
| Panes/Surfaces     | `surface.split` (left/right/up/down), `surface.list`, `pane.surfaces`, `surface.focus` | `cmux new-split right`, `cmux focus-panel --panel <id>`   |
| Input              | `surface.send_text`, `surface.send_key`                                                | `cmux send "npm test"`, `cmux send-key enter`             |
| **Sidebar status** | `set-status`, `clear-status`, `list-status`, `set-progress`, `clear-progress`          | `cmux set-status build passing --color green`             |
| **Logs**           | `log`, `clear-log`, `list-log`                                                         | `cmux log "tests started" --level progress`               |
| **Notifications**  | `notification.create` / `.list` / `.clear`                                             | `cmux notify --title "Claude" --body "waiting for input"` |
| Utility            | `ping`, `capabilities`, `identify`                                                     | `cmux identify`                                           |

Global flags: `--socket PATH`, `--json`, `--window/--workspace/--surface <id>`,
`--id-format refs|uuids|both`.

**Why this matters for us:** the sidebar line _"Claude is waiting for your input"_
is literally a `notify` / `set-status` call an agent makes. So our build order is:

```
Agent (Claude Code hook)
  → runs `shepherd notify --title Claude --body "waiting..."`
  → CLI connects to /tmp/shepherd.sock, sends {id, method:"notification.create", params}
  → Electron MAIN receives it, updates that Workspace's state (unread=true, attention=true)
  → MAIN pushes new state to RENDERER over IPC
  → React sidebar re-renders: status subtitle + ring/flash  ← the cmux look
```

### Our implementation (Node)

- **Main process:** `net.createServer` on `/tmp/shepherd.sock`; parse
  newline-delimited JSON; dispatch by `method`; mutate the Window/Workspace store;
  broadcast changes to the renderer via `webContents.send`.
- **CLI client:** `bin/shepherd.js` connects, writes one JSON line, and prints the
  response. `bin/cmux` is a compatibility launcher only.
- **Every terminal pane** gets `SHEPHERD_WORKSPACE_ID`, `SHEPHERD_SURFACE_ID`, and
  `SHEPHERD_SOCKET_PATH` injected into its env (via node-pty) so a command run _inside_
  a pane knows which workspace to update by default.

---

## Part 3 — Feature-by-feature parity map

Tiers: **🟢 Core v1** (needed for the cmux feel) · **🟡 v2** (polish/depth) ·
**🔵 Stretch** (later) · **⚪ Skip** (not worth it on Linux).

| #   | cmux feature                                                         | How we build it (Electron stack)                                                                                                                                                | Tier                                                        |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | **Object model** (Window→Workspace→Pane→Surface→Panel)               | the TS data model in Part 1; terminal panels only for v1                                                                                                                        | 🟢                                                          |
| 2   | **Vertical workspace sidebar**                                       | flat custom-name/project navigation with useful-only branch/usage/status metadata, contextual agent rows, accessible SVG actions, and restrained active state                   | 🟢                                                          |
| 3   | **Notification rings / tab flash / unread badge**                    | one-shot active-pane pulse plus stable counted workspace badges, driven by the bounded socket/OSC/provider inbox                                                                | 🟢                                                          |
| 4   | **Multiple terminals**                                               | node-pty per terminal panel, map `ptyId → process` in main                                                                                                                      | 🟢                                                          |
| 5   | **Split panes** (h/v)                                                | pure split tree + percentage tiling, one-pixel neutral dividers, flat pane geometry, contextual SVG actions, and unchanged drag targets                                         | 🟢                                                          |
| 6   | **Surfaces** (tabs within a pane)                                    | mounted xterm panel per surface, compact rectangular tabs, roving keyboard navigation, active-tab scrolling, and capability-aware close controls                                | 🟢                                                          |
| 7   | **Socket API + `shepherd` CLI**                                      | `net` server in main + tiny Node CLI client, with a compatibility launcher                                                                                                      | 🟢                                                          |
| 8   | **Sidebar status API** (`set-status`, `set-progress`, `log`)         | socket methods → workspace metadata → React status pills / progress bar                                                                                                         | 🟢 (status/notify) · 🟡 (pills+progress polish)             |
| 9   | **OSC 9/99/777 detection** (auto notifications from terminal output) | scan pty output stream in main for these escape codes → fire notification                                                                                                       | 🟢                                                          |
| 10  | **Automatic + semantic agent runtime**                               | zero-setup PTY process discovery, enriched lifecycle reports, urgency-sorted contextual workspace rows, bounded queries/inspection, exact focus/wait controls, and integrations | 🟢                                                          |
| 11  | **Single-workspace session restoration**                             | serialize the active workspace layout/cwd; relaunch with exactly that workspace and re-spawn its shells                                                                         | 🟢 (active layout+cwd) · 🟡 (scrollback/resume-all setting) |
| 12  | **Live project + Git branch in sidebar**                             | active shell cwd comes from `/proc`; main resolves/caches the worktree root and reads Git `HEAD`, then React renders separate project/branch rows                               | 🟢                                                          |
| 13  | **Keyboard shortcuts** (new/close/split/focus/nav)                   | React keymap plus Left/Right/Home/End tab navigation; Linux Ctrl/Super equivalents                                                                                              | 🟢                                                          |
| 14  | **Semantic dark theme**                                              | terminal-derived cmux backdrop, no-blue application interactions, restrained geometry, coordinated full xterm palette; optional Ghostty mapping (#20)                           | 🟢                                                          |
| 15  | **PR status/number in sidebar**                                      | optional bounded `gh pr view --json` probe keyed by active Git root/branch; passive failures stay hidden                                                                        | 🟢                                                          |
| 16  | **Listening ports in sidebar**                                       | bounded `/proc/net` inode matching against active-shell descendants, excluding inherited descriptors; cached and compact                                                        | 🟢                                                          |
| 17  | **Status pills w/ icon/color/priority + progress bars**              | extend the sidebar renderer; the socket already carries these params                                                                                                            | 🟡                                                          |
| 18  | **Notification panel + jump-to-unread**                              | accessible compact pending popover; cross-source deduplication, exact terminal jump, explicit read/resolve/clear, persistence, and Ctrl+Shift+U/M shortcuts                     | 🟢                                                          |
| 19  | **Command palette + project `shepherd.json` actions**                | typed contextual palette over existing workspace, terminal, pane, attention, and view actions; validated repo-local actions remain deferred                                     | 🟢 palette · 🟡 project actions                             |
| 20  | **Read Ghostty config** for theme/font/colors                        | parse `~/.config/ghostty/config` → apply to xterm theme (compat nicety)                                                                                                         | 🟡                                                          |
| 21  | **Settings UI** (font, theme, shell, keybinds)                       | compact modal entry with live persisted font controls plus honest theme/keybinding status; main-owned shell/config editing remains deferred                                     | 🟢 entry/font · 🟡 deeper settings                          |
| 22  | **Constrained localhost preview** + later browser automation         | shipped `Panel='preview'` in an ephemeral hardened webview with loopback-only requests, persistence, and cleanup; general browsing and automation remain separate future work   | 🟢 preview · 🔵 general browser/automation                  |
| 23  | **Remote SSH workspaces** (`shepherd ssh`, remote tmux, routing)     | spawn `ssh`/attach `tmux` in a pane; network routing is hard — defer                                                                                                            | 🔵                                                          |
| 24  | **Claude Code Teams mode** (`claude-teams` → teammates as splits)    | orchestrate multiple agent panes via the socket API                                                                                                                             | 🔵                                                          |
| 25  | **Skills system** (reusable agent workflows)                         | ship prompt/workflow snippets invokable from the palette                                                                                                                        | 🔵                                                          |
| 26  | **Git worktree-per-workspace**                                       | validated `new-worktree` socket/CLI flow creates or attaches a branch, then opens the canonical path as workspace cwd                                                           | 🟢                                                          |
| 27  | **GPU rendering**                                                    | xterm.js **WebGL addon** (our closest equivalent to libghostty)                                                                                                                 | 🟢-ish                                                      |
| 28  | **iOS companion / realtime sync**                                    | out of scope for a Linux desktop app                                                                                                                                            | ⚪                                                          |
| 29  | **libghostty rendering**                                             | we use xterm.js instead (see the decisions log)                                                                                                                                 | ⚪                                                          |
| 30  | **Sparkle auto-update**                                              | use AppImage self-update or GitHub Releases instead                                                                                                                             | ⚪                                                          |
| 31  | **Reproducible performance diagnostics**                             | production harness, opt-in lifecycle traces, and readiness-driven deferred discovery; rendered/interaction suites follow                                                        | 🟢 foundation · 🟡 expanded suites                          |
| 32  | **Bounded terminal output flow**                                     | 32 KiB/4 ms main-process batching, xterm write acknowledgements, interactive bypass, and PTY high/low-water backpressure                                                        | 🟢                                                          |
| 33  | **Adaptive background observation**                                  | content-free activity acceleration, quiet/hidden recovery cadences, non-overlapping agent and metadata scans, and exact renderer lifecycle deadlines                            | 🟢                                                          |
| 34  | **Owned terminal lifecycle**                                         | creator-authorized PTY control, renderer-loss cleanup, explicit scrollback/capture/queue bounds, aggregate memory diagnostics, and scaling/recovery benchmarks                  | 🟢                                                          |
| 35  | **Independent Shepherd identity**                                    | product constants, safe state selection, dual migration sockets, primary CLI, managed-hook upgrades, renderer/protocol identity, and Linux packaging                            | 🟢                                                          |
| 36  | **Safe clickable terminal links**                                    | Ctrl/Meta-click HTTP(S), OSC 8, and existing local paths through xterm providers, live shell-cwd resolution, owned IPC, and revalidated Electron opening                        | 🟢                                                          |
| 37  | **Current-terminal find and contextual shortcut help**               | bounded official xterm search with result navigation plus registry-derived, availability-aware keyboard help                                                                    | 🟢                                                          |

---

## Part 4 — Notification & status mechanics (deep dive)

This is cmux's signature, so worth getting exactly right. The app has **four input
channels** that converge on visible workspace and agent state:

1. **Automatic** — cmux watches terminal output for **OSC 9 / 99 / 777** escape
   sequences (the standard "desktop notification" terminal codes). Any program
   (or agent) that emits one triggers a notification with no setup.
2. **Explicit** — the `shepherd notify` / `set-status` / `log` CLI. The
   compatibility launcher still accepts old `cmux` invocations.
3. **Structured lifecycle** — provider hooks/plugins call `agent-report` with a
   semantic state plus optional activity or blocked reason. This feeds the Agents
   section and exact terminal navigation without parsing terminal prose.
4. **Automatic process discovery** — Electron main follows each owned PTY's Linux
   process ancestry and publishes a safe `working`/`idle` baseline for recognized
   agents. A structured lifecycle source replaces that baseline when available.

**Visual result:**

- New attention creates one 1.2-second active-pane ring; no row flashes forever.
- Each workspace keeps a stable counted unread badge after the pulse ends.
- A compact popover lists pending items and distinguishes unread, read-pending,
  resolved, and empty state.
- Jump-to-unread selects the exact workspace/pane/terminal. Mark-read and resolve
  are separate actions.
- Reduced-motion mode removes the pulse while retaining badge, text, and accessible labels.

**Our pipeline (single source of truth):**

```
[OSC parser on pty stream] ───┐
[socket: notify] ─────────────┼─► main validates/routes SocketApply
[provider blocked/done] ──────┘                  │
                                                ▼
                                  renderer bounded inbox reducer
                                      ├─► dedupe + persistence
                                      ├─► badge + popover + exact focus
                                      └─► one-shot ring

socket/OSC main path ─► OS desktop notification when supported
```

The semantic lifecycle path is separate but shares the same transport:

```text
provider hook/plugin
  → shepherd agent-report
  → main validates + resolves workspace
  → renderer binds the real pane/surface
  → agent list + lifecycle-owned inbox item when blocked/done
  → click or focus-agent selects the exact terminal
```

Without a provider integration, the automatic path still lists the agent:

```text
owned PTY + workspace/surface binding
  → bounded Linux foreground/parent inspection
  → safe provider/custom-agent classification
  → process:auto working/idle report
  → agent list + exact terminal focus
```

Automation can observe the same validated state without polling:

```text
shepherd watch-agents + query filters
  → sequence-zero snapshot
  → ordered agent-update upserts/removal tombstones
  → reconnect snapshot after disconnect or sequence gap
```

---

## Part 5 — What we deliberately cut for v1 (and why)

- **General browser + browser automation beyond the localhost preview (#22)** — the
  constrained loopback workflow ships, while arbitrary origins, durable browser state,
  downloads, permissions, remote routing, and automation remain outside v1.
- **Remote SSH network routing (#23)** — cmux routes browser panes through the
  remote's network; that's deep plumbing. Plain `ssh` in a pane works day one; the
  fancy routing is Stretch.
- **iOS companion (#28)** — irrelevant to a Linux desktop target.
- **libghostty (#29)** — the authentic renderer, but unstable C API + Zig; xterm.js
  - WebGL is the pragmatic call (see `ROADMAP.md` decisions log).

Cutting these keeps v1 focused on the **look + multitasking + agent-status** loop,
which is 90% of why the screenshot looks the way it does.

---

## Part 6 — Corrections this research makes to the original ROADMAP

1. **Object model is deeper than assumed.** Original plan said "tabs → panes."
   Real model is **Workspace → Pane → Surface → Panel**. `ROADMAP.md` M2/M3 updated.
2. **Sidebar status is socket-driven, not file-watched.** Original M3 proposed a
   `chokidar` state-dir watch. The faithful mechanism is the **socket API**, so a
   minimal socket server moves **into M3** (feeding the sidebar), then expands to
   the full control API in M5. File-watch is demoted to an optional fallback.
3. **OSC 9/99/777 parsing is a first-class notification source** — added to M4.
4. **Env injection into panes** (`SHEPHERD_WORKSPACE_ID` / `SHEPHERD_SURFACE_ID` /
   `SHEPHERD_SOCKET_PATH`) is required so in-pane commands can target the right
   workspace — added to M2/M4.

---

## v1 definition of done (the "it feels like cmux" bar)

- [x] Left sidebar of workspaces: name + live status subtitle + active highlight
- [x] Notification ring/flash + unread badge, from OSC parsing and `shepherd notify`
- [x] Real terminals (node-pty + xterm.js/WebGL), split into panes, tabs (surfaces) per pane
- [x] Socket API + `shepherd` CLI driving workspaces/status/notifications
- [x] Contextual workspace rows automatically show Codex, Claude Code, OpenCode,
      Kimi, other known CLIs, and safely named custom agents; lifecycle reporters add richer state
- [x] Active workspace layout + cwd restored as the single workspace on relaunch
- [x] Live project and Git branch shown for each workspace's active terminal
- [x] Optional PR status and process-owned listening ports shown as compact workspace context
- [x] Ctrl/Meta-click opens validated HTTP(S), OSC 8, and existing local-file links
- [ ] Final dark-theme matching pass

---

## Sources

- cmux landing — https://cmux.com/
- cmux docs: API/CLI — https://cmux.com/docs/api · Concepts — https://cmux.com/docs/concepts · Getting Started — https://cmux.com/docs/getting-started
- GitHub — https://github.com/manaflow-ai/cmux (README, CHANGELOG)
- Review (day-to-day workflow) — https://vibecoding.app/blog/cmux-review
