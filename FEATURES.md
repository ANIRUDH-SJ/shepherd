# cmux-linux — Feature Research & Implementation Map

Researched from the actual cmux source (cmux.com docs + `manaflow-ai/cmux` on
GitHub), then mapped feature-by-feature onto **our** Electron + xterm.js + node-pty

- React stack. This is the reference for _what cmux does_ and _how we'll build each
  piece_. Pairs with `ROADMAP.md` (the build order).

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
             └─ Panel   ← the actual content: a Terminal OR a Browser
```

- **Window** — an OS window; each has its own sidebar + independent workspaces.
- **Workspace** — one row in the sidebar. Carries the name, cwd, git branch, PR,
  ports, status pills, progress, and notification/unread state. Env: `CMUX_WORKSPACE_ID`.
- **Pane** — a resizable split region inside a workspace (the tiling).
- **Surface** — a tab inside a pane; a pane can hold several surfaces. Env: `CMUX_SURFACE_ID`.
- **Panel** — what's rendered in a surface: a **Terminal** (Ghostty session) or a **Browser**.

**Mapping to the screenshot you shared:** the left list = _workspaces_; each big
tiled region = a _pane_; the little tab bars on top of some regions = _surfaces_;
the terminal content = a _terminal panel_.

### Our data model (React/TypeScript)

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
type PaneNode =
  | { kind: 'leaf'; pane: Pane }
  | { kind: 'split'; dir: 'row' | 'col'; sizes: number[]; children: PaneNode[] }

interface Workspace {
  id: string
  name: string
  cwd: string
  layout: PaneNode // the split tree
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

> **Scope call for v1:** implement `Panel = 'terminal'` only. Keep the `type`
> field so a `'browser'` panel can slot in later without a refactor.

---

## Part 2 — The socket API (the backbone of everything)

cmux exposes a unix-socket JSON API; the `cmux` CLI is just a thin client to it.
This is how agents drive the sidebar AND how automation works. We mirror it.

**cmux's actual wire format** (we copy this):

- Socket path: `/tmp/cmux.sock` (release) — we'll use `/tmp/cmux-linux.sock`
- Override via `CMUX_SOCKET_PATH`
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
  → runs `cmux notify --title Claude --body "waiting..."`
  → CLI connects to /tmp/cmux-linux.sock, sends {id, method:"notification.create", params}
  → Electron MAIN receives it, updates that Workspace's state (unread=true, attention=true)
  → MAIN pushes new state to RENDERER over IPC
  → React sidebar re-renders: status subtitle + ring/flash  ← the cmux look
```

### Our implementation (Node)

- **Main process:** `net.createServer` on `/tmp/cmux-linux.sock`; parse
  newline-delimited JSON; dispatch by `method`; mutate the Window/Workspace store;
  broadcast changes to the renderer via `webContents.send`.
- **CLI client:** a tiny `cmux` bin (Node script) that connects, writes one JSON
  line, prints the response. This is what agents/scripts call.
- **Every terminal pane** gets `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`, and
  `CMUX_SOCKET_PATH` injected into its env (via node-pty) so a command run _inside_
  a pane knows which workspace to update by default.

---

## Part 3 — Feature-by-feature parity map

Tiers: **🟢 Core v1** (needed for the cmux feel) · **🟡 v2** (polish/depth) ·
**🔵 Stretch** (later) · **⚪ Skip** (not worth it on Linux).

| #   | cmux feature                                                           | How we build it (Electron stack)                                                                                                                                                     | Tier                                                        |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1   | **Object model** (Window→Workspace→Pane→Surface→Panel)                 | the TS data model in Part 1; terminal panels only for v1                                                                                                                             | 🟢                                                          |
| 2   | **Vertical workspace sidebar**                                         | custom-name/project identity, positional context, live branch/usage/status/agent rollup, accessible SVG actions, and restrained active state                                         | 🟢                                                          |
| 3   | **Notification rings / tab flash / unread badge**                      | React state + CSS animation, toggled by socket notify + OSC parse                                                                                                                    | 🟢                                                          |
| 4   | **Multiple terminals**                                                 | node-pty per terminal panel, map `ptyId → process` in main                                                                                                                           | 🟢                                                          |
| 5   | **Split panes** (h/v)                                                  | pure split tree + percentage tiling, live dividers, explicit active-pane chrome, and accessible SVG pane actions                                                                     | 🟢                                                          |
| 6   | **Surfaces** (tabs within a pane)                                      | mounted xterm panel per surface, semantic tablist/tabpanel links, roving keyboard navigation, and capability-aware close controls                                                    | 🟢                                                          |
| 7   | **Socket API + `cmux` CLI**                                            | `net` server in main + tiny Node CLI client (Part 2)                                                                                                                                 | 🟢                                                          |
| 8   | **Sidebar status API** (`set-status`, `set-progress`, `log`)           | socket methods → workspace metadata → React status pills / progress bar                                                                                                              | 🟢 (status/notify) · 🟡 (pills+progress polish)             |
| 9   | **OSC 9/99/777 detection** (auto notifications from terminal output)   | scan pty output stream in main for these escape codes → fire notification                                                                                                            | 🟢                                                          |
| 10  | **Automatic + semantic agent runtime**                                 | zero-setup PTY process discovery, enriched lifecycle reports, urgency-grouped sidebar with persistent empty state, bounded queries/inspection, focus/wait controls, and integrations | 🟢                                                          |
| 11  | **Single-workspace session restoration**                               | serialize the active workspace layout/cwd; relaunch with exactly that workspace and re-spawn its shells                                                                              | 🟢 (active layout+cwd) · 🟡 (scrollback/resume-all setting) |
| 12  | **Live project + Git branch in sidebar**                               | active shell cwd comes from `/proc`; main resolves/caches the worktree root and reads Git `HEAD`, then React renders separate project/branch rows                                    | 🟢                                                          |
| 13  | **Keyboard shortcuts** (new/close/split/focus/nav)                     | React keymap plus Left/Right/Home/End tab navigation; Linux Ctrl/Super equivalents                                                                                                   | 🟢                                                          |
| 14  | **Semantic dark theme**                                                | shared CSS tokens for surfaces, content, focus, state, spacing, and motion across sidebar and terminal chrome; optionally map validated Ghostty colors (#20)                         | 🟢                                                          |
| 15  | **PR status/number in sidebar**                                        | `gh pr view --json` (or GitHub API) per workspace branch                                                                                                                             | 🟡                                                          |
| 16  | **Listening ports in sidebar**                                         | main scans `/proc/net` or `ss -tlnp` for the pane's process tree                                                                                                                     | 🟡                                                          |
| 17  | **Status pills w/ icon/color/priority + progress bars**                | extend the sidebar renderer; the socket already carries these params                                                                                                                 | 🟡                                                          |
| 18  | **Notification panel + jump-to-unread**                                | a React panel listing notifications; keybind to focus latest unread workspace                                                                                                        | 🟡                                                          |
| 19  | **Command palette + project `cmux.json` actions**                      | a React command palette; read a repo-local `cmux.json` for custom launch actions                                                                                                     | 🟡                                                          |
| 20  | **Read Ghostty config** for theme/font/colors                          | parse `~/.config/ghostty/config` → apply to xterm theme (compat nicety)                                                                                                              | 🟡                                                          |
| 21  | **Settings UI** (font, theme, shell, keybinds)                         | a React settings pane persisting to `~/.config/cmux-linux/config.json`                                                                                                               | 🟡                                                          |
| 22  | **In-app browser panels** + browser automation API                     | `Panel='browser'` via a `<webview>`/`BrowserView`; automation over the socket                                                                                                        | 🔵                                                          |
| 23  | **Remote SSH workspaces** (`cmux ssh`, remote tmux, localhost routing) | spawn `ssh`/attach `tmux` in a pane; network routing is hard — defer                                                                                                                 | 🔵                                                          |
| 24  | **Claude Code Teams mode** (`claude-teams` → teammates as splits)      | orchestrate multiple agent panes via the socket API                                                                                                                                  | 🔵                                                          |
| 25  | **Skills system** (reusable agent workflows)                           | ship prompt/workflow snippets invokable from the palette                                                                                                                             | 🔵                                                          |
| 26  | **Git worktree-per-workspace**                                         | validated `new-worktree` socket/CLI flow creates or attaches a branch, then opens the canonical path as workspace cwd                                                                | 🟢                                                          |
| 27  | **GPU rendering**                                                      | xterm.js **WebGL addon** (our closest equivalent to libghostty)                                                                                                                      | 🟢-ish                                                      |
| 28  | **iOS companion / realtime sync**                                      | out of scope for a Linux desktop app                                                                                                                                                 | ⚪                                                          |
| 29  | **libghostty rendering**                                               | we use xterm.js instead (see the decisions log)                                                                                                                                      | ⚪                                                          |
| 30  | **Sparkle auto-update**                                                | use AppImage self-update or GitHub Releases instead                                                                                                                                  | ⚪                                                          |
| 31  | **Reproducible performance diagnostics**                               | production harness, opt-in lifecycle traces, and readiness-driven deferred discovery; rendered/interaction suites follow                                                             | 🟢 foundation · 🟡 expanded suites                          |
| 32  | **Bounded terminal output flow**                                       | 32 KiB/4 ms main-process batching, xterm write acknowledgements, interactive bypass, and PTY high/low-water backpressure                                                             | 🟢                                                          |

---

## Part 4 — Notification & status mechanics (deep dive)

This is cmux's signature, so worth getting exactly right. The app has **four input
channels** that converge on visible workspace and agent state:

1. **Automatic** — cmux watches terminal output for **OSC 9 / 99 / 777** escape
   sequences (the standard "desktop notification" terminal codes). Any program
   (or agent) that emits one triggers a notification with no setup.
2. **Explicit** — the `cmux notify` / `set-status` / `log` CLI. The compatibility
   command `cmux hooks setup` installs the Claude Code integration.
3. **Structured lifecycle** — provider hooks/plugins call `agent-report` with a
   semantic state plus optional activity or blocked reason. This feeds the Agents
   section and exact terminal navigation without parsing terminal prose.
4. **Automatic process discovery** — Electron main follows each owned PTY's Linux
   process ancestry and publishes a safe `working`/`idle` baseline for recognized
   agents. A structured lifecycle source replaces that baseline when available.

**Visual result (what we replicate):**

- The pane gets a **ring**; the workspace row in the sidebar **lights up / flashes**;
  an **unread badge** appears.
- A **notification panel** lists pending items; a shortcut **jumps to the latest unread**.
- Colors: cmux lets `set-status --color` drive color; reviewers describe
  green=done / yellow=waiting / red=error conventions. We'll support a color field
  and ship those as the default convention.

**Our pipeline (single source of truth):**

```
[OSC parser on pty stream]  ─┐
                             ├─► main: markWorkspaceAttention(wsId, payload)
[socket: notify/set-status] ─┘        │
                                      ├─► update Workspace metadata + unread/attention
                                      ├─► webContents.send → React (ring + flash + badge)
                                      └─► OS desktop notification (Electron Notification API)
```

The semantic lifecycle path is separate but shares the same transport:

```text
provider hook/plugin
  → cmux agent-report
  → main validates + resolves workspace
  → renderer binds the real pane/surface
  → agent list + derived unread/attention
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
cmux watch-agents + query filters
  → sequence-zero snapshot
  → ordered agent-update upserts/removal tombstones
  → reconnect snapshot after disconnect or sequence gap
```

---

## Part 5 — What we deliberately cut for v1 (and why)

- **In-app browser + browser automation (#22)** — big surface area; the terminal
  experience is the core. Data model leaves room (`Panel='browser'`) to add later.
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
4. **Env injection into panes** (`CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` /
   `CMUX_SOCKET_PATH`) is required so in-pane commands can target the right
   workspace — added to M2/M4.

---

## v1 definition of done (the "it feels like cmux" bar)

- [x] Left sidebar of workspaces: name + live status subtitle + active highlight
- [x] Notification ring/flash + unread badge, from BOTH OSC parse and `cmux notify`
- [x] Real terminals (node-pty + xterm.js/WebGL), split into panes, tabs (surfaces) per pane
- [x] Socket API + `cmux` CLI driving workspaces/status/notifications
- [x] Agents section automatically detects Codex, Claude Code, OpenCode, Kimi,
      other known CLIs, and safely named custom agents; lifecycle reporters add richer state
- [x] Active workspace layout + cwd restored as the single workspace on relaunch
- [x] Live project and Git branch shown for each workspace's active terminal
- [ ] Final dark-theme matching pass

---

## Sources

- cmux landing — https://cmux.com/
- cmux docs: API/CLI — https://cmux.com/docs/api · Concepts — https://cmux.com/docs/concepts · Getting Started — https://cmux.com/docs/getting-started
- GitHub — https://github.com/manaflow-ai/cmux (README, CHANGELOG)
- Review (day-to-day workflow) — https://vibecoding.app/blog/cmux-review
