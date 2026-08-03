# Shepherd — Build Roadmap

Shepherd is an AI-native terminal workspace for Linux, originally motivated by
the absence of [cmux](https://cmux.com/) on Linux. It combines a vertical
workspace sidebar, agent state, split panes, and a socket automation API, while
now evolving under an independent product identity.

**Stack:** Electron + xterm.js + node-pty + React + TypeScript + Vite.

- **Renderer (UI):** React + TypeScript + CSS — sidebar, tabs, tiled panes.
- **Terminals:** xterm.js (+ fit, webgl, search addons).
- **PTY / shells:** node-pty in the Electron main process.
- **Backend (main process):** Node — window lifecycle, pty management,
  state-dir file watching (chokidar), unix-socket automation API.
- **Bridge:** Electron IPC + preload `contextBridge`.
- **Build/package:** Vite + electron-builder → AppImage / .deb / Flatpak.

**Mental model:** main process = "the Express backend", renderer = "the React
frontend", IPC = "the API calls between them".

---

## Progress at a glance

- [x] **M0** — Project setup & scaffolding ✓
- [x] **M1** — Window shell: sidebar + one live terminal ✓
- [x] **M2** — Multiple terminals, tabs & split panes ✓
- [x] **M3** — Workspace sidebar, status, and notification rings ✓
- [x] **M4** — Agent integration & session persistence ✓
- [x] **M5** — Socket API and automation ✓
- [ ] **M6** — Polish, theming & packaging/distribution
- [x] **M7** — Semantic agent runtime, sidebar, control API, and provider integrations ✓
- [x] **M8** — Git worktree workspace creation and cwd propagation ✓
- [x] **M9** — Filtered live agent subscriptions ✓
- [x] **M10** — Automatic terminal-agent discovery with no provider setup ✓
- [x] **M11** — Live workspace project and Git branch metadata ✓
- [x] **M12** — Deterministic single-workspace startup ✓
- [x] **M13** — Semantic UI design-token foundation ✓
- [x] **M14** — Sidebar workspace and agent information hierarchy ✓
- [x] **M15** — Accessible terminal tabs, pane focus, and workspace context ✓
- [x] **M16** — Reproducible terminal benchmark foundation ✓
- [ ] **M17** — Render, interaction, scalability, and agent-overhead benchmarks
- [x] **M18** — Readiness-driven background startup ✓
- [x] **M19** — Bounded, acknowledged terminal output batching ✓
- [x] **M20** — Adaptive event-driven runtime observation ✓
- [x] **M21** — Renderer-owned terminal lifecycle and memory accounting ✓
- [x] **M22** — Shepherd product, CLI, packaging, and compatibility identity ✓
- [x] **M23** — Safe clickable terminal URLs, OSC 8 links, and local file references ✓
- [x] **M24** — Minimal, flat workspace sidebar ✓
- [x] **M25** — Minimal terminal tabs, headers, panes, and controls ✓
- [x] **M26** — Neutral terminal-first theme and semantic interaction states ✓
- [x] **M27** — Notification center, meaningful rings, and jump-to-unread ✓
- [x] **M28** — Compact pull-request and listening-port workspace metadata ✓
- [x] **M29** — Terminal find, command palette, contextual help, and settings entry ✓
- [x] **M30** — Constrained localhost preview surface ✓
- [x] **M31** — cmux terminal-derived theme and unified window backdrop ✓

---

> **Companion doc:** [`FEATURES.md`](./FEATURES.md) — the feature map, object
> model (Window→Workspace→Pane→Surface→Panel), and socket API this roadmap now
> reflects. Read it alongside these milestones.

> **Deferred agent-workspace UI plan:**
> [`AGENT_WORKSPACE_UI_PLAN.md`](./AGENT_WORKSPACE_UI_PLAN.md) — the
> dependency-ordered, one-feature-per-PR plan for task-first navigation,
> attention management, review, worktree task creation, session lifecycle,
> terminal context, permissions, previews, and later agent-work experiments.
> This document is planning only; its features are not implemented yet. Every
> feature requires both `learning/` and `textbook/` updates after its behavior
> settles.

> **Completed cmux-parity delivery plan:**
> [`CMUX_UI_PARITY_PLAN.md`](./CMUX_UI_PARITY_PLAN.md) — the one-PR-per-milestone
> sequence for removing dashboard-like UI, restoring terminal-first hierarchy,
> and then adding cmux-inspired notifications, metadata, utilities, and preview.
> M24–M30 are complete; the deferred agent-workspace panels remain separately planned.

## M0 — Project setup & scaffolding

_Goal: an empty Electron + React + TS window that opens and hot-reloads._

- [ ] Init repo: `git init`, add `.gitignore`, `LICENSE` (MIT), `README.md`
- [ ] Scaffold with `electron-vite` (Vite + Electron + React + TS template)
- [ ] Confirm the three-file structure: `main/`, `preload/`, `renderer/`
- [ ] Get an empty React window opening via `npm run dev`
- [ ] Verify hot-reload works for the renderer
- [ ] Set up ESLint + Prettier + TS strict mode
- [ ] Add npm scripts: `dev`, `build`, `lint`
- [ ] Commit the baseline

## M1 — Window shell: sidebar + one live terminal

_Goal: a window with a placeholder sidebar on the left and ONE terminal you can
actually type commands into. This is the make-or-break milestone — it teaches
the pty-over-IPC loop._

- [ ] Install `xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`, `node-pty`
- [ ] Lay out the app shell: fixed-width sidebar + flexible main area (CSS)
- [ ] Render a static placeholder sidebar (hardcoded list items)
- [ ] **Main process:** spawn a shell with node-pty (`bash`/`$SHELL`)
- [ ] **Preload:** expose safe `onPtyData`, `sendPtyInput`, `resizePty` via `contextBridge`
- [ ] **Renderer:** mount an xterm.js instance into a React component
- [ ] Wire pty → xterm: stream pty `data` over IPC, write to terminal
- [ ] Wire xterm → pty: send `onData` keystrokes back to the shell
- [ ] Handle resize: FitAddon + send new cols/rows to node-pty
- [ ] Confirm: open the app, type `ls`, see output. 🎉
- [ ] Clean up pty process on window close (no zombies)
- [ ] Commit

## M2 — Multiple terminals, tabs & split panes

_Goal: open several terminals, organized into tabs, with horizontal/vertical
splits inside a tab — like cmux's panes._

- [ ] Refactor: a `Terminal` React component keyed by a unique `paneId`
- [ ] Main process: manage a **map of ptyId → pty process** (not just one)
- [ ] IPC: include `paneId` in all pty messages so data routes correctly
- [ ] Inject `SHEPHERD_WORKSPACE_ID` / `SHEPHERD_SURFACE_ID` / `SHEPHERD_SOCKET_PATH` into each pane's env
- [ ] App state model: **Workspace → Pane → Surface → Panel** tree (see FEATURES.md Part 1)
- [ ] Add a per-pane tab bar = **surfaces** (create / switch / close)
- [ ] Integrate a tiling layout for splits (`react-mosaic` or hand-rolled flex)
- [ ] Split commands: split-right / split-down within the active workspace
- [ ] Focus handling: clicking a pane focuses it; visible focus ring
- [ ] Close a single pane (kill its pty, collapse the layout)
- [ ] Keyboard shortcuts: new tab, close pane, split (define a keymap)
- [ ] Resize splits with the mouse (draggable dividers)
- [ ] Commit

## M3 — Workspace sidebar

_Goal: the left sidebar matches the screenshot — named workspaces, a status
subtitle per item, active highlight, and notification markers._

- [ ] Define a "workspace" model (name, cwd, status, unread/attention flag)
- [ ] Build the sidebar React component to match cmux styling (dark theme)
- [ ] Active workspace highlight (graphite selection block)
- [ ] Status subtitle line under each name ("Claude is waiting for your input")
- [x] Notification markers: counted unread badge + one-shot active-pane pulse (CSS)
- [ ] Click a workspace → switch to its tab/pane group
- [x] Rename a workspace inline or through the socket/CLI without recreating it
- [ ] **State source = socket API:** stand up a minimal `net` unix-socket server in
      main handling `set-status` / `log` / `notify` — this is what feeds the sidebar
      (the full control API comes in M5). See FEATURES.md Part 2.
- [ ] Socket messages update workspace metadata → push to renderer via IPC → re-render
- [ ] (Optional fallback) also accept status from a watched state dir (`chokidar`)
- [ ] Sidebar: **resizable width (drag handle)** + collapse/expand toggle (cmux's sidebar button)
      — reuses the draggable-divider logic built for panes in M2
- [ ] Empty state + "new workspace" affordance (the `+` button)
- [ ] Commit

## M4 — Agent integration & session persistence

_Goal: real AI agents drive the sidebar status, and the workspace survives a
restart._

- [ ] Define the status protocol: what an agent signals
      "waiting / running / done / needs attention"
- [ ] Ship the `shepherd` CLI client (thin socket client) + a `shepherd notify` shortcut
- [x] **OSC 9/99/777 parser:** scan pty output in main → auto-fire notifications
- [x] Wire Claude Code's `Notification` hook through `shepherd integrations setup`
- [x] Map incoming notifications to the exact workspace and terminal
- [x] Trigger one bounded pane pulse + stable unread badge + desktop notification
- [ ] **Persistence:** serialize tabs/panes/cwds + workspace list to JSON on change
- [ ] Restore the full layout on next launch (re-spawn shells in saved cwds)
- [ ] "Restore previous session?" vs fresh-start handling
- [ ] Commit

## M5 — Full socket control API

_Goal: expand the M3 socket server from status-only to full programmatic control,
mirroring cmux's method surface. Easier in Node than cmux's Swift version._

- [ ] Adopt cmux's wire format: newline-terminated JSON `{id, method, params}` (FEATURES.md Part 2)
- [ ] `workspace.*` — create / list / select / current / close
- [ ] `surface.split` (left/right/up/down), `surface.list`, `pane.surfaces`, `surface.focus`
- [ ] `surface.send_text` / `surface.send_key` — drive a pane programmatically
- [ ] `set-progress` / `clear-progress`, `list-status`, `list-log`, `sidebar-state`
- [ ] `ping` / `capabilities` / `identify` utility methods
- [ ] Round out the `shepherd` CLI to cover all methods; document the protocol
- [ ] Commit

## M6 — Polish, theming & packaging/distribution

_Goal: it looks finished and other people can install it._

- [ ] Final theme pass to match cmux (colors, fonts, spacing, rings)
- [x] App icon + window title/branding
- [x] Persisted terminal font-size setting + zoom shortcuts
- [ ] Settings UI: theme, default shell, keybindings
- [x] xterm.js WebGL renderer enabled
- [ ] WebGL perf check (scroll, big output)
- [ ] Empty/error states, keyboard-shortcut cheat sheet
- [x] Agent-reported per-workspace token usage with exact/estimated provenance
- [x] Configure `electron-builder` for **AppImage** and **.deb**
- [ ] Configure **Flatpak** packaging
- [x] Build AppImage and `.deb` artifacts
- [ ] Test-install on a clean Ubuntu
- [x] README install and usage instructions
- [ ] README screenshots
- [ ] (Optional) GitHub Actions CI: lint + build on push
- [ ] Tag a `v0.1.0` release

## M7 — Semantic agent runtime

_Goal: show provider-neutral live agent state, make it actionable, and connect
documented provider lifecycle events without scraping terminal prose._

- [x] Define semantic states (`working`, `blocked`, `done`, `idle`, `unknown`)
      separately from working activity and blocked reason
- [x] Validate identity, ownership, source, sequencing, display text, stale
      policy, and TTL at the Unix-socket boundary
- [x] Bind every report to an existing workspace, pane, and terminal surface
- [x] Derive workspace unread/attention state and clean records on expiry, pane
      close, workspace close, terminal exit, explicit clear, and session restore
- [x] Add `agent-report`, `agent-clear`, `list-agents`, `focus-agent`, and
      `wait-agent` socket/CLI methods
- [x] Add validated multi-field agent queries, bounded summaries, and a versioned
      reconnect snapshot
- [x] Publish a versioned machine-readable agent schema and build capability
      discovery with shared runtime limits
- [x] Add agent-scoped terminal inspection with capped capture, bounded plain-text
      output, dimensions, cwd, and safe Linux foreground-process identity
- [x] Add a keyboard-accessible Agents section with urgent-first ordering,
      reduced-motion support, and exact terminal focus
- [x] Add workspace agent-state rollups, elapsed observation labels, and a
      stale-to-unknown lifecycle transition before final expiry
- [x] Add idempotent lifecycle setup for Codex and Claude Code plus a managed
      OpenCode plugin, preserving existing user configuration
- [x] Bound Codex stale state with lifecycle-aware expiry, sequence OpenCode
      reports, and degrade unsupported events without retaining their payloads
- [x] Cover the contract, reducer, view, wait logic, socket, CLI, event mapping,
      and installers with regression tests
- [x] Add the implementation walkthrough and full architecture chapter

## M8 — Git worktree workspaces

_Goal: create or attach an isolated Git branch directory and open it as a normal
workspace without shell interpolation or hidden cleanup._

- [x] Validate absolute repository/target paths and exactly one branch mode
- [x] Support new branches with optional start point and existing branches
- [x] Run bounded Git argv processes in Electron main without a shell
- [x] Create the renderer workspace only after Git succeeds
- [x] Propagate canonical worktree cwd into the first node-pty shell
- [x] Cover real temporary repositories, reducer cwd, socket validation, and CLI flags
- [x] Add implementation learning notes and the architecture textbook chapter

## M9 — Live agent subscriptions

_Goal: let automation observe filtered semantic state without polling or scraping._

- [x] Reuse validated agent queries for long-lived subscriptions
- [x] Start every stream with a versioned sequence-zero snapshot
- [x] Emit ordered upserts, removal tombstones, and replacement summaries
- [x] Bound subscriber count and disconnect slow consumers
- [x] Clean subscriptions on connection close and server shutdown
- [x] Add `watch-agents` CLI streaming with correct NDJSON framing
- [x] Publish the subscription envelope in schema/capability discovery
- [x] Add socket, protocol, CLI, learning, and architecture coverage

## M10 — Automatic terminal-agent discovery

_Goal: list agents started in Shepherd terminals without requiring hooks,
configuration edits, or manual lifecycle reports._

- [x] Anchor discovery to registered PTYs for exact workspace/surface ownership
- [x] Read bounded Linux foreground-to-shell process ancestry
- [x] Retain only safe executable/script basenames, never prompts or arguments
- [x] Recognize common agent CLIs plus safely named future/custom agents
- [x] Derive zero-setup `working`/`idle` state from recent PTY activity
- [x] Prefer rich provider lifecycle reports without duplicate sidebar rows
- [x] Clear automatic records when the process, terminal, or application exits
- [x] Publish automatic-discovery capability in the agent protocol
- [x] Cover classification, precedence, deduplication, rediscovery, and cleanup
- [x] Prove detection and cleanup against a live isolated Electron app
- [x] Add the implementation walkthrough and architecture textbook chapter

## M11 — Live workspace project and Git branch

_Goal: replace the static cwd placeholder with project and branch context that
tracks the active terminal after `cd`, `git switch`, or `git checkout`._

- [x] Mirror the active terminal surface for every workspace
- [x] Read the interactive shell cwd from bounded Linux `/proc` state
- [x] Resolve Git worktree root and absolute Git directory without shell interpolation
- [x] Cache Git location and observe branch changes cheaply through `HEAD`
- [x] Re-probe bounded non-Git locations so `git init` is discovered
- [x] Reject late metadata from a previously active pane or tab
- [x] Persist the last active cwd while deriving fresh project/branch data on restore
- [x] Propagate restored/worktree cwd through TerminalHost into node-pty
- [x] Render separate accessible project and branch rows in the sidebar
- [x] Cover helpers, Git parsing, cache behavior, reducer ownership, and cwd changes
- [x] Verify real `cd` and `git switch` transitions in an isolated Electron window
- [x] Add implementation learning notes and the full architecture chapter

## M12 — Deterministic single-workspace startup

_Goal: every launch begins with one workspace while retaining the most relevant
durable context from the previous session._

- [x] Confirm fresh construction already creates exactly one workspace
- [x] Identify multi-workspace session replay as the duplicate-looking startup source
- [x] Restore only the previously active workspace from legacy snapshots
- [x] Preserve its name, cwd, tabs, panes, split layout, and active pane
- [x] Persist only the active workspace as the next startup recipe
- [x] Keep runtime multi-workspace creation and switching unchanged
- [x] Reset transient agents, usage, attention, and derived Git metadata on restore
- [x] Cover legacy restore and serializer cardinality with reducer regressions
- [x] Document the implementation, alternatives, security, and tradeoffs

## M13 — Semantic UI design tokens

_Goal: give every renderer component one semantic visual vocabulary before
changing sidebar and terminal information architecture._

- [x] Define surface, content, interaction, and semantic-state color roles
- [x] Define shared UI/mono fonts, spacing, radii, shadow, and motion values
- [x] Replace raw component colors with CSS custom-property consumption
- [x] Standardize selection, scrollbar, focus, and control transitions
- [x] Preserve reduced-motion behavior for repeating attention animations
- [x] Enforce the root token boundary with an executable regression test
- [x] Document the code, CSS architecture, accessibility, security, and tradeoffs

## M14 — Sidebar information hierarchy

_Goal: make project identity and actionable agent state readable at a glance
without changing runtime contracts._

- [x] Promote the live project when a workspace has no custom name
- [x] Keep workspace position as stable secondary context
- [x] Render branch, usage, status, and agent rollup in a predictable order
- [x] Keep the Agents section and compact empty explanation visible from startup
- [x] Group agents into actionable, working, waiting, finished, and quiet bands
- [x] Replace sidebar action glyphs with a closed local SVG icon set
- [x] Cover identity and urgency projections with pure regressions
- [x] Verify empty and fully populated states in live Electron windows
- [x] Document implementation, architecture, accessibility, security, and tradeoffs

## M15 — Terminal chrome and context

_Goal: make nested pane/tab focus clear and keyboard-operable while keeping the
terminal canvas visually dominant._

- [x] Implement semantic tablist, tab, and tabpanel relationships
- [x] Add roving Left/Right/Home/End keyboard navigation with wrap
- [x] Make surface selection activate its validated owning pane in the reducer
- [x] Show compact workspace, Git, pane, and terminal context above the pane layer
- [x] Distinguish active tabs from the active pane with restrained indicators
- [x] Reveal pane actions on hover and keyboard focus with accessible SVG controls
- [x] Disable impossible last-pane and last-terminal close actions
- [x] Cover navigation, DOM ids, context summaries, and reducer state parity
- [x] Verify single-pane and nested three-pane layouts in live Electron windows
- [x] Document implementation, architecture, accessibility, security, and tradeoffs

## M16 — Reproducible terminal benchmark foundation

_Goal: replace terminal-performance impressions with a production-only,
machine-readable, safe, and repeatable measurement protocol._

- [x] Build and smoke-test fresh AppImage and Debian production artifacts
- [x] Run one identical controlling-TTY worker inside every terminal subject
- [x] Generate deterministic ASCII, Unicode, and ANSI fixtures with digests
- [x] Measure process-to-worker-ready startup, PSS/RSS, idle CPU, and parser round trip
- [x] Capture exact versions, sources, commit, hardware, display, GL, and host pressure
- [x] Retain raw samples/failures and derive median, p95, mean, range, and MAD
- [x] Randomize subject order and distinguish warmups from measured rounds
- [x] Reject pressured hosts unless the run is explicitly and permanently a pilot
- [x] Separate broad measurement ownership from marker-verified cleanup authority
- [x] Validate Shepherd, Kitty, Ghostty, and GNOME Terminal in a live pilot
- [x] Document usage, actual code, architecture, security, alternatives, and tradeoffs

## M17 — Expanded terminal performance suites

_Goal: measure presentation and interaction behavior that parser throughput
cannot represent, then scale the same workloads across terminal counts._

- [x] Add opt-in main/renderer/xterm/PTY startup milestones and bounded JSON summaries
- [ ] Measure AppImage cold/warm launch separately from the unpacked binary
- [ ] Add a visible sentinel and settled-frame presentation observer
- [ ] Measure software event-to-present input latency with explicit proxy labeling
- [ ] Automate matched scrolling and window/pane resizing with frame/CPU observations
- [ ] Measure equivalent 1, 2, 4, and 8 terminal layouts
- [ ] Isolate automatic agent-discovery overhead from terminal-count overhead
- [ ] Run a redirected CPU workload as a terminal-independent control
- [ ] Compare hardware acceleration, software rendering, and unavailable-GPU fallback
- [ ] Publish controlled raw JSON/CSV plus analysis only after the pressure gate passes

## M18 — Readiness-driven background startup

_Goal: keep terminal construction on the startup critical path while preserving
eventually consistent agent and workspace observers._

- [x] Define a payload-free, one-shot first-terminal readiness handshake
- [x] Keep PTY, session, socket, workspace mirroring, and window setup early
- [x] Defer agent discovery and workspace metadata to separate later event-loop turns
- [x] Replay the newest pre-start workspace mirror to each delayed service
- [x] Cancel pending work and stop live services safely during shutdown
- [x] Trace terminal readiness separately from background-service activation
- [x] Cover scheduling, deduplication, replay, failure, and cleanup with tests
- [x] Verify live metadata refresh plus automatic agent appearance and removal
- [x] Document implementation, architecture, security, alternatives, and tradeoffs

## M19 — Bounded terminal output batching

_Goal: reduce per-chunk work during sustained PTY output without delaying
interactive output or allowing an unbounded renderer queue._

- [x] Coalesce adjacent background output with a 32 KiB target and 4 ms deadline
- [x] Forward the first PTY output and recent-input output immediately
- [x] Acknowledge each batch only after xterm consumes its write
- [x] Limit normal renderer in-flight output to 128 KiB
- [x] Pause node-pty at 256 KiB and resume it below 64 KiB
- [x] Preserve terminal ordering, split Unicode, inspection, and OSC parsing
- [x] Drain pending output before exit and explicit terminal disposal
- [x] Validate acknowledgements and bind them to the terminal's owning window
- [x] Cover batching, flow control, failure, and lifecycle boundaries with tests
- [x] Prove ANSI, Unicode, OSC, input, and exit ordering in live Electron
- [x] Record a matched 20-sample production comparison and its limitations
- [x] Document implementation, architecture, security, alternatives, and tradeoffs

## M20 — Adaptive event-driven runtime observation

_Goal: reduce quiet and hidden background work while preserving bounded,
self-healing agent and workspace freshness._

- [x] Define active, quiet, hidden, and restore freshness contracts
- [x] Add one deterministic, non-overlapping adaptive scheduler
- [x] Publish content-free registration, input, output, and removal activity
- [x] Accelerate process discovery on activity and rich-authority changes
- [x] Ignore output-only churn for workspace metadata
- [x] Back quiet visible scans off to five seconds for agents and three for metadata
- [x] Retain 15-second hidden recovery and immediate restore reconciliation
- [x] Replace renderer lifecycle polling with exact stale/expiry deadlines
- [x] Stop empty or hidden elapsed-label refreshes
- [x] Cover timing, visibility, async overlap, errors, and cleanup deterministically
- [x] Prove agent appearance/removal and cwd/branch refresh in live Electron
- [x] Record a matched 20-sample production idle-CPU comparison
- [x] Document implementation, architecture, security, alternatives, and tradeoffs

## M21 — Renderer-owned terminal lifecycle and memory accounting

_Goal: bind every main-process PTY to its creator, release it after renderer
loss, make retention limits explicit, and explain terminal-count memory growth._

- [x] Add a deterministic terminal/renderer ownership registry
- [x] Authorize create/replace, input, resize, acknowledgement, and disposal
- [x] Release every renderer-owned PTY on destruction or renderer-process failure
- [x] Prevent stale exit or cleanup callbacks from touching replacement terminals
- [x] Use one owner-loss listener pair per renderer rather than per terminal
- [x] Make the 1,000-line xterm scrollback contract explicit
- [x] Report opt-in content-free resource counts at lifecycle boundaries
- [x] Measure production PSS/RSS at 1, 2, 4, and 8 real PTYs
- [x] Repeat matched 8→1 close cycles and classify allocator high-water behavior
- [x] Verify exact terminal, owner, inspection, queue, and process-count recovery
- [x] Prove benchmark cleanup with direct-child ownership and PID start ticks
- [x] Document implementation, architecture, security, alternatives, and tradeoffs

## M22 — Shepherd product identity and compatibility migration

_Goal: establish Shepherd as the complete product and repository identity
without discarding existing sessions, automation, or managed integrations._

- [x] Centralize current and legacy product constants and environment precedence
- [x] Select legacy user data only when it contains app-owned state and the new path does not
- [x] Publish `/tmp/shepherd.sock` while serving the legacy default socket during migration
- [x] Make `shepherd` the primary CLI and retain a tested compatibility launcher
- [x] Inject new pane environment variables alongside compatibility aliases
- [x] Upgrade exact managed provider hooks and OpenCode plugins without touching user code
- [x] Rename renderer, schema, diagnostics, benchmarks, package, executable, and desktop identity
- [x] Migrate the persisted font-size key without resetting the user preference
- [x] Build and inspect a real unpacked Shepherd production artifact
- [x] Document implementation, architecture, security, alternatives, and tradeoffs

## M23 — Safe clickable terminal links

_Goal: make useful terminal output actionable while keeping untrusted text,
filesystem access, and desktop opening behind explicit validation boundaries._

- [x] Detect wrapped plain HTTP(S) URLs with the official xterm addon
- [x] Honor OSC 8 HTTP(S) and local-file links through a strict protocol allowlist
- [x] Parse bounded absolute, home, dot-relative, project-relative, and bare file references
- [x] Preserve optional `path:line:column` metadata for future editor navigation
- [x] Map UTF-16 parser offsets to exact xterm cells, including wide characters
- [x] Confirm file existence lazily against the interactive shell's live cwd
- [x] Require terminal ownership and revalidate every target on activation
- [x] Open through Electron APIs without shell commands or interpolation
- [x] Preserve terminal focus and selection through Ctrl/Meta-click activation
- [x] Cover parsers, ranges, IPC validation, resolution, opening, and async teardown
- [x] Prove URL, existing file, missing file, and OSC 8 hover behavior in isolated Electron
- [x] Document implementation, architecture, security, alternatives, and tradeoffs

## M24–M30 — cmux UI parity and terminal-first simplification

_Goal: replace Shepherd's dashboard-like presentation with a compact terminal-first
shell, then add only the cmux-inspired context and utilities that remain useful._

- [x] **M24:** remove permanent agent/shortcut furniture and flatten the workspace sidebar
- [x] **M25:** compact workspace/tab chrome and remove ordinary pane-card styling
- [x] **M26:** neutralize the palette and reserve accent/motion for semantic state
- [x] **M27:** add bounded pending notifications, meaningful rings, and unread navigation
- [x] **M28:** add reliable, compact PR and listening-port metadata
- [x] **M29:** replace shortcut furniture with terminal find, palette, help, and settings
- [x] **M30:** add a constrained localhost preview after the terminal shell is stable
- [x] Deliver every milestone on its own branch and PR using the commit, verification,
      screenshot, `learning/`, and `textbook/` gates in
      [`CMUX_UI_PARITY_PLAN.md`](./CMUX_UI_PARITY_PLAN.md)

## M31 — cmux terminal-derived theme

_Goal: make the terminal theme the visual anchor for the whole window instead of
rendering terminal, sidebar, tabs, and first paint as separate dark rectangles._

- [x] Measure the official cmux screenshot and inspect its current appearance source
- [x] Share the `#272823` terminal backdrop across permanent renderer chrome
- [x] Keep selected, focused, informational, Git, tab, and terminal-selection states free of blue
- [x] Flatten active tabs to one accent edge and remove the redundant workspace rail
- [x] Apply the matching BrowserWindow first-paint color
- [x] Define the full coordinated xterm ANSI palette
- [x] Add structural, contrast, terminal-theme, and live computed-style verification
- [x] Document implementation, architecture, alternatives, security, and extension points

---

## Stretch / later (post-v1)

- [ ] Implement the deferred agent-workspace UI series one feature and PR at a
      time, following [`AGENT_WORKSPACE_UI_PLAN.md`](./AGENT_WORKSPACE_UI_PLAN.md);
      begin only after the cmux parity series is visually accepted;
      complete code/tests first, then update both `learning/` and `textbook/`
      before closing each feature
- [ ] Port the React UI to **Tauri** for lean binaries (~10× smaller, less RAM)
- [ ] General browser panels + browser automation API beyond the constrained localhost preview
- [ ] Remote SSH workspaces + localhost routing; Claude Code Teams mode
- [ ] Worktree cleanup and diff/review UI (creation workflow landed in M8)
- [ ] Cross-platform builds (Windows/Mac) — Electron makes this nearly free
- [ ] Investigate libghostty embedding once its C API stabilizes (most authentic
      renderer — currently too unstable to depend on)

---

## Notes & decisions

- Chose **Electron over Tauri** for v1: same React UI, but bundled Chromium
  renders xterm.js canvas/WebGL more smoothly on Linux than WebKitGTK, and it's
  the fastest path on a React/Node skill set. UI ports to Tauri later near-free.
- Chose **Electron over libghostty embed**: libghostty is the renderer cmux
  itself uses, but its embedding C API is still unstable and it's Zig — wrong
  effort-to-payoff for now. Revisit at Level 3.
- The **renderer reducer** is the backbone for live agent state. Bounded PTY
  process discovery provides zero-setup presence, while the Unix socket accepts
  richer provider lifecycle reports. A watched state directory is not required.
