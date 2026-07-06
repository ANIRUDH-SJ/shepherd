# 🛠️ learning/ — the "as we build" log

This folder is a **running, plain-English journal of what we actually built**, one
file per milestone. Every time we finish a milestone (M0, M1, M2, …), a new file
lands here explaining — in depth — *what was added, why, how it works, and how the
pieces connect*, using the real code from this repo.

> **Not to be confused with:**
> - **`../textbook/`** — teaches the *general technologies* (Electron, terminals,
>   sockets…) from scratch. Read that to learn the concepts.
> - **`../LEARNING.md`** — the *study plan* (what to learn, in what order).
> - **This folder** — a diary of *our specific codebase* as it grows. Read this to
>   understand what the actual files in this project do, milestone by milestone.

Think of it as: textbook = the theory; `learning/` = the annotated tour of *our*
code as we write it.

## Index

| Milestone | File | What it covers |
|---|---|---|
| **M0** | `M0-project-scaffold.md` | The Electron + React + TypeScript skeleton: every file, the build pipeline, how to run it |
| **M1** | `M1-terminal.md` | One real terminal: node-pty (backend) + xterm.js (UI) + the IPC loop, function by function |
| **M2** | `M2-panes-tabs-splits.md` | Many terminals: the flat keyed pane layer, tabs, resizable splits, the pure layout engine + its test |
| M3 | _(coming)_ | The workspace sidebar + minimal socket server |
| M4 | _(coming)_ | Agent status + notifications + session restore |
| M5 | _(coming)_ | The full socket control API |
| M6 | _(coming)_ | Theming + packaging |

## How to read a milestone file

Each file follows the same shape:
1. **The goal** — what this milestone set out to do.
2. **What we added** — the new files/tree.
3. **File-by-file** — every file explained, with the important lines called out.
4. **How it connects** — the data flow, tied to `../textbook/` chapters.
5. **What's intentionally minimal / deferred** — so you know what's a stub.
6. **Checkpoint** — questions to confirm you understand what we built.
