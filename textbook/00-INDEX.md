# 📚 The cmux-linux Textbook — Start Here

Welcome. This folder is a **from-scratch textbook** that explains _everything_
about how the cmux-linux project works and every technology it's built on. It is
written to be read like a book: verbose, example-driven, and building concept on
concept. If you read it in order, you will understand not just _what_ the code
does but _why_ every piece exists.

> **You are "vibe coding" this project** — building with an AI pair — and this
> textbook is your ground truth so you're never lost about what's happening under
> the hood. Every abstract concept is tied back to _our actual app_.

---

## Who this is for

You (Ani): a full-stack dev comfortable with **React / Node / Express**, learning
**desktop + systems programming** (Electron, terminals, IPC, sockets) for the
first time. No prior Electron or terminal-internals knowledge is assumed. Where a
concept overlaps something you already know, the book says so and moves faster.

---

## How to use this book

1. **Read in numeric order the first time.** Chapters are sequenced so each one
   only depends on earlier ones. `01 → 02 → 03 …`
2. **Each chapter is self-contained enough to revisit.** When you're deep in a
   milestone and need a refresher, jump straight to the relevant chapter.
3. **Read it beside the build docs.** This book explains _concepts_; `ROADMAP.md`
   is the _build order_ and `FEATURES.md` is _what we're building_. They cross-link.
4. **Do the checkpoints.** Every chapter ends with a small exercise or set of
   questions. If you can answer them, you've got it.

---

## ⚡ New to Electron? Start with the crash course

If you've never used Electron, **read `electron-crash-course.md` first.** It's a
~30–45 min hands-on build of a tiny working app that teaches the entire two-process
model with runnable, copy-pasteable examples — and it ends with a realistic
"how long will this take to learn?" breakdown. Do it before the deep chapters
below and everything here will click much faster.

## 🗺️ The reading order (the learning path)

Think of the book in five "acts":

**Act I — Foundations (the mental model)**

- `01-the-big-picture.md` — what cmux is, what we're building, the whole
  architecture on one page. **Read this first, always.**
- `02-how-terminals-work.md` — the physics of a terminal: TTY, PTY, shells,
  stdin/stdout, and the escape codes that make colors and cursors happen. This is
  the soul of the whole app.

**Act II — The Electron platform (the shell of the app)**

- `03-electron-architecture.md` — the two-process model (main vs renderer), the
  app lifecycle, and windows.
- `04-ipc-inter-process-communication.md` — how the two processes talk. The most
  important Electron skill.
- `05-preload-and-context-isolation.md` — the secure bridge that connects them.

**Act III — The terminal stack (making a real terminal)**

- `06-node-pty.md` — spawning real shells in the backend.
- `07-xtermjs.md` — drawing the terminal in the UI.

**Act IV — The app's brain (structure, layout, data)**

- `08-react-in-this-app.md` — the component tree and the hooks we lean on.
- `09-typescript-and-the-data-model.md` — TypeScript essentials + our
  Window→Workspace→Pane→Surface→Panel model.
- `10-tiling-and-layout.md` — how split panes actually work (the layout tree).

**Act V — The cmux magic + shipping**

- `11-the-socket-api.md` — the unix-socket API that drives the sidebar and
  automation (the backbone of the "cmux feel").
- `12-notifications-and-osc.md` — notification rings, and the OSC escape codes
  that trigger them automatically.
- `13-session-persistence.md` — session serialization and restore fundamentals.
- `14-build-tooling-and-vite.md` — how the project is bundled and hot-reloaded.
- `15-packaging-and-distribution.md` — turning it into an AppImage/.deb others install.
- `18-usage-telemetry.md` — trustworthy token/cost measurements: provenance,
  validation, aggregation, adapters, UI tradeoffs, and testing.
- `19-semantic-agent-runtime.md` — provider-neutral lifecycle state, identity,
  ordering, socket automation, sidebar focus, integrations, and trust boundaries.
- `20-worktree-workspaces.md` — safe Git worktree creation, process boundaries,
  workspace cwd propagation, failure semantics, and testing.
- `21-live-state-subscriptions.md` — filtered snapshot-plus-delta streams,
  ordering, reconnect behavior, backpressure, and cleanup.
- `22-automatic-process-discovery.md` — zero-setup terminal-agent detection,
  Linux process ancestry, safe identity, activity inference, and authority.
- `23-live-workspace-metadata.md` — active-terminal cwd, Git/worktree discovery,
  cached branch observation, state ownership, persistence, and sidebar design.
- `24-single-workspace-startup.md` — startup cardinality, active-workspace
  projection, backward compatibility, and persistence tradeoffs.
- `25-semantic-ui-tokens.md` — CSS custom properties, semantic visual roles,
  accessibility, validation, and theme extension boundaries.
- `26-sidebar-information-architecture.md` — project-first identity, urgency
  grouping, progressive disclosure, accessible icons, and dense layout tradeoffs.
- `27-terminal-interaction-design.md` — ARIA tabs, roving focus, pane/tab state,
  xterm lifetime, context strips, capability controls, and interaction tradeoffs.
- `28-terminal-performance-measurement.md` — honest benchmark boundaries,
  deterministic workloads, PSS/CPU accounting, statistics, process safety, and
  extension into rendered and interaction suites.
- `29-runtime-performance-observability.md` — cross-process startup milestones,
  monotonic timing, opt-in overhead, bounded IPC, readiness semantics, and
  optimization workflow.
- `30-startup-critical-path-scheduling.md` — semantic terminal readiness,
  deferred observer scheduling, latest-state replay, failure isolation, and
  cleanup.

**Reference**

- `16-glossary.md` — every term, defined in one place. Skim anytime.
- `17-how-it-all-connects.md` — the capstone: we trace a single keystroke _and_ an
  agent notification end-to-end through every layer you learned. Read this last;
  it ties the whole book together.

---

## 📇 Full table of contents (annotated)

| File                                    | You'll learn                                                                                          | Needs first |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- |
| `electron-crash-course.md`              | ⚡ Hands-on Electron intro (tiny working app) + learn-time estimates                                  | —           |
| `01-the-big-picture.md`                 | The problem, our architecture, the core data-flow loop                                                | —           |
| `02-how-terminals-work.md`              | TTY/PTY, shells, stdin/stdout, ANSI/OSC escape codes                                                  | 01          |
| `03-electron-architecture.md`           | Main vs renderer, Chromium+Node, app lifecycle, BrowserWindow                                         | 01          |
| `04-ipc-inter-process-communication.md` | invoke/handle, send/on, webContents.send, our channels                                                | 03          |
| `05-preload-and-context-isolation.md`   | preload scripts, contextBridge, the sandbox, `window.api`                                             | 03, 04      |
| `06-node-pty.md`                        | Pseudo-terminals in Node: spawn, data, resize, kill, env injection                                    | 02, 03      |
| `07-xtermjs.md`                         | The Terminal object, addons (fit/webgl/search), theming, mounting                                     | 02, 06      |
| `08-react-in-this-app.md`               | Component tree, useState/useEffect/useRef, why refs for xterm                                         | 07          |
| `09-typescript-and-the-data-model.md`   | TS essentials + our object model + the split tree                                                     | 08          |
| `10-tiling-and-layout.md`               | The layout tree, tiling algorithm, resize, focus                                                      | 09          |
| `11-the-socket-api.md`                  | Unix sockets, the JSON protocol, the server + `cmux` CLI                                              | 04, 09      |
| `12-notifications-and-osc.md`           | OSC 9/99/777, parsing the pty stream, the rings/flash pipeline                                        | 06, 11      |
| `13-session-persistence.md`             | Serializing + restoring the object model, snapshots                                                   | 09, 11      |
| `14-build-tooling-and-vite.md`          | Vite, electron-vite, bundling main/preload/renderer, HMR                                              | 03          |
| `15-packaging-and-distribution.md`      | electron-builder, AppImage/.deb/Flatpak, icons, updates                                               | 14          |
| `16-glossary.md`                        | Every term defined                                                                                    | —           |
| `17-how-it-all-connects.md`             | End-to-end trace of a keystroke + a notification                                                      | all         |
| `18-usage-telemetry.md`                 | Token accounting, accuracy, provider-neutral events, validation, aggregation, adapters, and UI design | 09, 11, 13  |
| `19-semantic-agent-runtime.md`          | Semantic state machines, lifecycle reports, identity, ordering, adapters, agent UI, and automation     | 09, 11, 12  |
| `20-worktree-workspaces.md`             | Git worktree isolation, validated process execution, workspace cwd flow, and failure boundaries        | 06, 09, 11  |
| `21-live-state-subscriptions.md`        | Snapshot-plus-delta streams, filters, ordering, reconnect behavior, and slow-consumer bounds            | 11, 19      |
| `22-automatic-process-discovery.md`     | Linux PTY process ancestry, safe command identity, classification, activity, precedence, and cleanup    | 06, 19      |
| `23-live-workspace-metadata.md`         | Shell cwd, Git roots, cached HEAD observation, async ownership, persistence, and project/branch UI       | 06, 09, 20  |
| `24-single-workspace-startup.md`        | Startup cardinality, active-workspace projection, compatibility, security, and persistence tradeoffs     | 09, 13, 23  |
| `25-semantic-ui-tokens.md`              | Semantic CSS tokens, cascade architecture, visual hierarchy, accessibility, validation, and theming      | 08, 14      |
| `26-sidebar-information-architecture.md` | Workspace identity, agent urgency projections, empty states, SVG boundaries, accessibility, and layout   | 08, 19, 25  |
| `27-terminal-interaction-design.md`       | Semantic tabs, roving focus, pane activation, xterm visibility, context strips, and capability controls   | 07, 08, 10, 25 |
| `28-terminal-performance-measurement.md`  | Production benchmarks, workload/end-point design, PSS/CPU, robust statistics, process ownership, and safety | 02, 06, 07, 15 |
| `29-runtime-performance-observability.md` | Cross-process startup traces, semantic boundaries, monotonic clocks, disabled overhead, security, and optimization | 03, 04, 07, 28 |
| `30-startup-critical-path-scheduling.md` | Critical-path classification, readiness handshakes, late consumers, event-loop turns, and failure handling | 03, 04, 29 |

---

## 🧭 One-page project digest (grounding for every chapter)

Keep this in the back of your mind while reading anything:

**What we're building:** _cmux-linux_ — a Linux desktop app that recreates
**cmux** (a Mac-only "terminal built for multitasking"): a vertical sidebar of
named workspaces, each showing a live status ("Claude is waiting for your
input"), notification rings when an agent needs you, split terminal panes, and a
socket API for automation.

**The stack:**

- **Electron** — the desktop app shell (a Node backend + a Chromium frontend).
- **React + TypeScript** — the UI (sidebar, tabs, tiled panes).
- **xterm.js** — draws the terminals in the UI.
- **node-pty** — spawns the real shells behind those terminals.

**The object model (memorize this):**

```
Window → Workspace → Pane → Surface → Panel(Terminal | Browser)
```

**The core data-flow loop (the whole app in one diagram):**

```
  RENDERER (React + xterm.js)         PRELOAD          MAIN (Node)
  ───────────────────────────       (window.api)     ─────────────────────
  you type in a terminal    ──send──►  IPC  ──────►  node-pty writes to shell
  terminal shows output     ◄──push──  IPC  ◄──────  shell output (pty.onData)
  sidebar shows agent status ◄─push──  IPC  ◄──────  socket API (cmux CLI)
        = "the frontend"        = "the API"           = "the backend"
```

Everything in this book is, ultimately, explaining one part of that loop.

---

## ✍️ Conventions used throughout

- **`🔧 In cmux-linux:`** boxes connect the general concept to our actual code.
- **`⚠️ Gotcha:`** flags a common mistake before you hit it.
- **`🧪 Checkpoint:`** ends each chapter — answer these to confirm understanding.
- ASCII diagrams are used liberally; code examples are in TypeScript/JavaScript.
- Analogies map new ideas onto things you already know (Express, React, the web).

---

## A note on how this book grows

The concept chapters (technologies) are complete up front — you can read and
understand them before writing a line of code. As we actually build each
milestone, we'll deepen the relevant chapter with real snippets from _our_ code,
so the book and the codebase stay in sync. Nothing here is throwaway.

**Now go read `01-the-big-picture.md`.** 🚀

## Runtime extensions

- `19-semantic-agent-runtime.md` — provider-neutral lifecycle state and ownership
- `20-worktree-workspaces.md` — safe Git worktree orchestration
- `21-live-state-subscriptions.md` — snapshot-plus-delta streams, ordering, and backpressure
- `22-automatic-process-discovery.md` — zero-setup agent presence and safe process ancestry
- `23-live-workspace-metadata.md` — live project/branch context from the active terminal
- `24-single-workspace-startup.md` — deterministic one-workspace relaunch policy
- `25-semantic-ui-tokens.md` — semantic CSS contract and visual-system foundation
- `26-sidebar-information-architecture.md` — project-first identity and explicit agent urgency groups
- `27-terminal-interaction-design.md` — accessible nested pane/tab focus and terminal chrome
- `28-terminal-performance-measurement.md` — reproducible terminal measurement and safe process accounting
- `29-runtime-performance-observability.md` — bounded cross-process startup phase traces
- `30-startup-critical-path-scheduling.md` — readiness-driven background service activation
