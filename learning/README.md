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

| Milestone | File                                         | What it covers                                                                                                                                   |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M0**    | `M0-project-scaffold.md`                     | The Electron + React + TypeScript skeleton: every file, the build pipeline, how to run it                                                        |
| **M1**    | `M1-terminal.md`                             | One real terminal: node-pty (backend) + xterm.js (UI) + the IPC loop, function by function                                                       |
| **M2**    | `M2-panes-tabs-splits.md`                    | Many terminals: the flat keyed pane layer, tabs, resizable splits, the pure layout engine + its test                                             |
| **M3**    | `M3-workspaces-and-socket.md`                | Multi-workspace sidebar (status, markers, resize, collapse) + the unix-socket server + `shepherd` CLI                                            |
| **M4**    | `M4-agents-and-persistence.md`               | OSC auto-notifications, `shepherd hooks setup`, and session restore (+ the review hardening)                                                     |
| **M5**    | `M5-socket-control.md`                       | Full socket control API: workspace + surface control + queries, and the review hardening                                                         |
| **M6**    | `M6-usage-telemetry.md`                      | Agent-reported token usage: validation, socket/CLI flow, reducer aggregation, sidebar UI, and tests                                              |
| **M7**    | `M7-semantic-agent-runtime.md`               | Semantic lifecycle state: contract, socket controls, reducer ownership, sidebar, focus, and adapters                                             |
| **M8**    | `M8-worktree-workspaces.md`                  | Safe Git worktree creation: validated Git execution, socket orchestration, workspace cwd, and tests                                              |
| **M9**    | `M9-agent-event-subscriptions.md`            | Filtered agent snapshots and ordered live upsert/removal events over the Unix socket                                                             |
| **M10**   | `M10-automatic-agent-discovery.md`           | Zero-setup Linux process discovery, activity state, source precedence, cleanup, and live proof                                                   |
| **M11**   | `M11-live-workspace-metadata.md`             | Active-terminal cwd, cached Git discovery, live project/branch UI, persistence, and visual proof                                                 |
| **M12**   | `M12-single-workspace-startup.md`            | Deterministic one-workspace startup, active-layout persistence, compatibility, and regression tests                                              |
| **M13**   | `M13-ui-design-tokens.md`                    | Semantic palette, typography, geometry, interaction rules, and CSS boundary regression                                                           |
| **M14**   | `M14-sidebar-information-hierarchy.md`       | Project-first workspace identity, agent urgency groups, accessible icons, empty states, and visual proof                                         |
| **M15**   | `M15-terminal-chrome.md`                     | ARIA tabs, roving focus, pane activation, context strip, SVG actions, capability states, and split proof                                         |
| **M16**   | `M16-terminal-benchmark-harness.md`          | Production artifact proof, deterministic fixtures, process accounting, pressure gates, safe cleanup, and pilot validation                        |
| **M17**   | `M17-runtime-performance-instrumentation.md` | Opt-in main/renderer/xterm/PTY startup milestones, bounded summaries, disabled hot paths, and live proof                                         |
| **M18**   | `M18-deferred-background-startup.md`         | First-terminal readiness handshake, delayed discovery services, latest-state replay, cleanup, and live proof                                     |
| **M19**   | `M19-terminal-output-batching.md`            | Bounded PTY batching, xterm acknowledgements, backpressure, lifecycle correctness, and matched benchmark proof                                   |
| **M20**   | `M20-adaptive-runtime-polling.md`            | Activity-aware agent and metadata scans, visibility backoff, exact renderer deadlines, cleanup, and measured idle-CPU proof                      |
| **M21**   | `M21-terminal-memory-lifecycle.md`           | Renderer-owned PTYs, crash cleanup, explicit retention bounds, aggregate diagnostics, and 1/2/4/8 lifecycle proof                                |
| **M22**   | `M22-shepherd-rebrand.md`                    | Product identity, state compatibility, sockets, CLI aliases, managed hooks, renderer settings, packaging, and tests                              |
| **M23**   | `M23-clickable-terminal-links.md`            | URL, OSC 8, and existing-file detection, xterm cell ranges, validated IPC opening, security, tests, and live proof                               |
| **M24**   | `M24-minimal-workspace-sidebar.md`           | Flat workspace navigation, contextual agent rows, useful-only metadata, exact focus, density, and visual proof                                   |
| **M25**   | `M25-minimal-terminal-chrome.md`             | Compact context/tabs, flat panes, hairline splits, hover/focus actions, active-tab visibility, and multi-pane proof                              |
| **M26**   | `M26-neutral-ui-theme.md`                    | Neutral shell palette, semantic-only color/motion, accessible focus, independent xterm theme, contrast tests, and live proof                     |
| **M27**   | `M27-notification-center.md`                 | Bounded persistent inbox, cross-source deduplication, exact unread navigation, explicit resolution, one-shot rings, and accessible popover proof |
| **M28**   | `M28-workspace-pr-port-metadata.md`          | Optional bounded PR discovery, process-owned listeners, cache invalidation, compact context, false-positive hardening, and live proof            |
| **M29**   | `M29-terminal-utilities.md`                  | Bounded terminal find, typed command registry, palette ranking, contextual help, minimal settings, modal focus, and live proof                   |

## How to read a milestone file

Each file follows the same shape:

1. **The goal** — what this milestone set out to do.
2. **What we added** — the new files/tree.
3. **File-by-file** — every file explained, with the important lines called out.
4. **How it connects** — the data flow, tied to `../textbook/` chapters.
5. **What's intentionally minimal / deferred** — so you know what's a stub.
6. **Checkpoint** — questions to confirm you understand what we built.
