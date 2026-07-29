# 🛠️ learning/ — the "as we build" log

This folder is a **running, plain-English journal of what we actually built**, one
file per milestone. Every time we finish a milestone (M0, M1, M2, …), a new file
lands here explaining — in depth — _what was added, why, how it works, and how the
pieces connect_, using the real code from this repo.

> **Not to be confused with:**
>
> - **`../textbook/`** — teaches the _general technologies_ (Electron, terminals,
>   sockets…) from scratch. Read that to learn the concepts.
> - **`../LEARNING.md`** — the _study plan_ (what to learn, in what order).
> - **This folder** — a diary of _our specific codebase_ as it grows. Read this to
>   understand what the actual files in this project do, milestone by milestone.

Think of it as: textbook = the theory; `learning/` = the annotated tour of _our_
code as we write it.

## Index

| Milestone | File                           | What it covers                                                                                       |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **M0**    | `M0-project-scaffold.md`       | The Electron + React + TypeScript skeleton: every file, the build pipeline, how to run it            |
| **M1**    | `M1-terminal.md`               | One real terminal: node-pty (backend) + xterm.js (UI) + the IPC loop, function by function           |
| **M2**    | `M2-panes-tabs-splits.md`      | Many terminals: the flat keyed pane layer, tabs, resizable splits, the pure layout engine + its test |
| **M3**    | `M3-workspaces-and-socket.md`  | Multi-workspace sidebar (status, markers, resize, collapse) + the unix-socket server + `cmux` CLI    |
| **M4**    | `M4-agents-and-persistence.md` | OSC auto-notifications, `cmux hooks setup`, and session restore (+ the review hardening)             |
| **M5**    | `M5-socket-control.md`         | Full socket control API: workspace + surface control + queries, and the review hardening             |
| **M6**    | `M6-usage-telemetry.md`        | Agent-reported token usage: validation, socket/CLI flow, reducer aggregation, sidebar UI, and tests  |
| **M7**    | `M7-semantic-agent-runtime.md` | Semantic lifecycle state: contract, socket controls, reducer ownership, sidebar, focus, and adapters |
| **M8**    | `M8-worktree-workspaces.md`    | Safe Git worktree creation: validated Git execution, socket orchestration, workspace cwd, and tests |
| **M9**    | `M9-agent-event-subscriptions.md` | Filtered agent snapshots and ordered live upsert/removal events over the Unix socket               |
| **M10**   | `M10-automatic-agent-discovery.md` | Zero-setup Linux process discovery, activity state, source precedence, cleanup, and live proof    |
| **M11**   | `M11-live-workspace-metadata.md` | Active-terminal cwd, cached Git discovery, live project/branch UI, persistence, and visual proof    |
| **M12**   | `M12-single-workspace-startup.md` | Deterministic one-workspace startup, active-layout persistence, compatibility, and regression tests |
| **M13**   | `M13-ui-design-tokens.md` | Semantic palette, typography, geometry, interaction rules, and CSS boundary regression              |
| **M14**   | `M14-sidebar-information-hierarchy.md` | Project-first workspace identity, agent urgency groups, accessible icons, empty states, and visual proof |
| **M15**   | `M15-terminal-chrome.md` | ARIA tabs, roving focus, pane activation, context strip, SVG actions, capability states, and split proof |
| **M16**   | `M16-terminal-benchmark-harness.md` | Production artifact proof, deterministic fixtures, process accounting, pressure gates, safe cleanup, and pilot validation |
| **M17**   | `M17-runtime-performance-instrumentation.md` | Opt-in main/renderer/xterm/PTY startup milestones, bounded summaries, disabled hot paths, and live proof |

## How to read a milestone file

Each file follows the same shape:

1. **The goal** — what this milestone set out to do.
2. **What we added** — the new files/tree.
3. **File-by-file** — every file explained, with the important lines called out.
4. **How it connects** — the data flow, tied to `../textbook/` chapters.
5. **What's intentionally minimal / deferred** — so you know what's a stub.
6. **Checkpoint** — questions to confirm you understand what we built.
