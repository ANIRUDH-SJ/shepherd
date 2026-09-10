# Shepherd

> **A graphical terminal multiplexer with agent awareness.**

Shepherd is an open-source, terminal-first desktop workspace for Linux. It
combines real shells, tabs, and split panes with a compact workspace rail,
automatic coding-agent discovery, semantic attention, Git and runtime context,
secure localhost previews, and a Unix-socket automation API.

It is a terminal multiplexer at its foundation. Agent awareness is what makes it
different: Shepherd helps you run several coding agents without turning the app
into an AI dashboard or losing track of what needs you.

> [!IMPORTANT]
> Shepherd is in early development. The core terminal, workspace, agent,
> notification, preview, and automation systems are implemented, but interfaces
> and protocols may still change before a stable release.

[Download Shepherd v0.1.0](https://github.com/ANIRUDH-SJ/shepherd/releases/tag/v0.1.0)
· [Installation and verification](docs/INSTALLATION.md)

## Why Shepherd?

AI coding changes the developer's job. Instead of watching one terminal, you may
have several agents working across different projects, branches, and tasks.
Traditional terminal multiplexers can arrange those sessions, but they cannot
tell you which agent is testing, finished, blocked, or waiting for approval.

Shepherd turns that collection of terminals into an understandable workspace:

- **Workspaces keep projects separate.** The rail stays compact while each row
  summarizes meaningful agent state in words.
- **Tabs and splits organize real shells.** Every terminal is backed by a real
  PTY, so interactive programs behave as expected.
- **Agents become visible.** Shepherd discovers supported terminal agents and
  derives calm, semantic states without filling the rail with permanent cards.
- **Attention is routed, not demanded.** A dedicated section contains only
  actionable blocks and unseen completions. Selecting an item jumps to its exact
  terminal.
- **Automation is built in.** The `shepherd` CLI and socket API can create
  workspaces, split panes, send input, publish status, inspect agents, and stream
  lifecycle updates.
- **Parallel work stays isolated.** A Git branch can be opened as a dedicated
  worktree-backed workspace.
- **Local apps stay beside the terminal.** Shepherd discovers ports opened by
  workspace processes and can show an explicitly selected localhost app in a
  constrained preview surface.
- **Context is available on demand.** The workspace inspector collects the
  repository, branch, pull request, owned ports, agents, usage, and session
  structure without taking rows away from the terminal.

## More Than a Terminal Multiplexer

| A traditional terminal multiplexer | Shepherd adds                                                     |
| ---------------------------------- | ----------------------------------------------------------------- |
| Sessions, tabs, and split panes    | Named project workspaces and a compact workspace rail             |
| A grid of terminal output          | Semantic agent state and a focused Attention queue                |
| Manual checking                    | Unseen-completion state, blocked-work routing, and notifications  |
| Terminal navigation                | Exact agent-to-pane-and-tab navigation                            |
| Shell scripting                    | A validated Unix-socket API and the `shepherd` CLI                |
| Parallel shells in one checkout    | Git worktree creation for branch-isolated tasks                   |
| Always-visible metadata            | An on-demand repository, runtime, agent, usage, and session panel |

Shepherd is not an AI model, chatbot, or full IDE. It is the terminal-first
workspace around tools such as Codex, Claude Code, OpenCode, and other
command-line agents.

## What Works Today

- Real interactive shells powered by `node-pty`
- GPU-accelerated terminal rendering with xterm.js and WebGL fallback
- Multiple named workspaces
- Per-pane terminal tabs and draggable horizontal or vertical splits
- Live project name, working directory, Git branch, pull-request, and owned-port
  context
- Automatic Linux process discovery for recognized terminal agents
- Optional structured lifecycle integrations for richer agent state
- Compact workspace rollups, an actionable Attention section, and exact-terminal
  focus
- Bounded agent inspection, filtered snapshots, waits, and live subscriptions
- A bounded notification center with unread navigation, resolution, and
  workspace targeting
- Status, log, usage, and notification reporting over the socket API
- Git worktree workspace creation
- Active-workspace session restoration, including cwd, tabs, panes, and layout
- Safe Ctrl/Meta-click opening for HTTP(S), OSC 8, and existing local-file links
- Terminal search, a typed command palette, contextual shortcut help, and
  categorized settings
- A constrained localhost preview that blocks remote navigation, popups,
  downloads, and permission requests
- System, Light, and Dark appearance with matching application and terminal
  surfaces, plus stable semantic ANSI colors
- An on-demand workspace inspector for repository, pull-request, port, agent,
  usage, and session context
- AppImage and Debian package targets
- Compatibility aliases for earlier `cmux` scripts during the migration window

## Product Tour

### Terminal-first workbench

Workspace identity uses a compact titlebar above the pane layer, while every pane
keeps a dedicated tab row. Flat neutral surfaces keep the terminal dominant,
close behavior stays local to the active tab, and infrequent operations live in
the command palette or context menus. A fresh profile introduces the essential
shortcuts inside the first real terminal and can replay them with `shepherd
welcome`.

The welcome is printed into the first real shell, so the launch screen remains a
usable terminal rather than a separate onboarding page.

### Context when you ask for it

Select the workspace name in the titlebar, choose **Inspect workspace** from a
workspace context menu, or run **Inspect current workspace** from the command
palette. The inspector shows the current repository and branch, pull request,
owned ports, agent activity, reported usage, and pane/surface counts. Port and
agent rows are actions: they open the secure preview or focus the real terminal.

### Attention without terminal checking

Blocked agents and unseen completions enter the compact Attention section.
Socket and OSC notifications also feed a bounded inbox. Both routes can return
you to the workspace and exact terminal that produced the event.

### Localhost browser preview

Open a detected loopback server beside its owning terminal. This is browser
support for local development previews, not unrestricted web browsing: navigation
remains restricted to localhost and uses a dedicated Electron session boundary.

## Install

The current pre-1.0 build is
[Shepherd v0.1.0](https://github.com/ANIRUDH-SJ/shepherd/releases/tag/v0.1.0)
for x86-64 Linux. Download the AppImage or Debian package from that release and
use its `SHA256SUMS.txt` file to verify the download.

### AppImage

```bash
chmod +x Shepherd-*.AppImage
./Shepherd-*.AppImage
```

### Debian or Ubuntu

```bash
sudo apt install ./Shepherd_*_amd64.deb
shepherd
```

You can also launch **Shepherd** from the desktop application menu after
installing the Debian package.

See [Installation and verification](docs/INSTALLATION.md) for direct downloads,
checksum commands, AppImage fallback instructions, and uninstall steps.

### Build from source

Clone the repository on Linux with Node.js and npm available, then run:

```bash
npm install
npm run dev
```

`npm install` installs the native `node-pty` dependency. If your platform cannot
use its prebuilt binary, the installation may require the usual native Node.js
build toolchain.

## Quick Start

1. Open Shepherd. The first workspace starts in a real shell.
2. Open your project directory and launch a terminal-based coding agent as you
   normally would.
3. Use `Ctrl+Shift+N` for another workspace, `Ctrl+Shift+T` for a tab, or the
   split shortcuts to run work side by side.
4. Press `Ctrl+Shift+P` to discover workspace, pane, attention, and view actions.
5. Watch the rail for semantic workspace rollups and the Attention section for
   actionable work.
6. Open the workspace inspector when you need Git, pull-request, port, agent,
   usage, or session detail.

Basic agent presence is automatic for recognized processes. For richer semantic
events—such as _testing_, _waiting for approval_, or _done_—install the optional
provider integrations from inside a Shepherd terminal:

```bash
shepherd integrations setup
```

You can target one provider with `shepherd integrations setup codex`,
`shepherd integrations setup claude`, or `shepherd integrations setup opencode`.
Run `shepherd integrations setup` again after upgrades when you want Shepherd to
refresh its managed integration blocks. Codex users must also review and trust
new lifecycle hooks in Codex before they become active.

## Keyboard and Mouse

| Shortcut                   | Action                                      |
| -------------------------- | ------------------------------------------- |
| `Ctrl+Shift+D`             | Split the active pane to the right          |
| `Ctrl+Shift+E`             | Split the active pane downward              |
| `Ctrl+Shift+T`             | Open a terminal tab in the active pane      |
| `Ctrl+Shift+N`             | Create a workspace                          |
| `Ctrl+Shift+W`             | Close the active surface or pane            |
| `Ctrl+Shift+B`             | Toggle the sidebar                          |
| `Ctrl+Shift+F`             | Find in the active terminal                 |
| `Ctrl+Shift+P`             | Open the command palette                    |
| `Ctrl+Shift+U`             | Jump to the latest unread notification      |
| `Ctrl+Shift+M`             | Mark the current workspace read             |
| `Ctrl+Shift+=` / `-` / `0` | Zoom terminal in / out / reset              |
| `Ctrl+Shift+,`             | Open settings                               |
| `Ctrl+Shift+?`             | Show contextual shortcut help               |
| `F2` on a workspace        | Rename the workspace                        |
| `Ctrl`/`Meta` + click      | Open a validated terminal URL or local file |

When a terminal tab has keyboard focus, Left/Right wraps across tabs, Home/End
selects the first or last tab, and Delete closes the focused tab when another
surface remains. Workspace rows use Arrow keys plus Home/End for navigation.

Workspaces can also be renamed from their context menu, by double-clicking the
name, or with the pencil action. Saving an empty name returns to the live project
name.

## Agent-Aware Automation

Every Shepherd terminal receives these environment variables:

- `SHEPHERD_WORKSPACE_ID` — the workspace containing the terminal
- `SHEPHERD_SURFACE_ID` — the terminal surface itself
- `SHEPHERD_SOCKET_PATH` — the active Unix socket, normally
  `/tmp/shepherd.sock`

It also receives the `shepherd` command on its `PATH`, so commands automatically
target the correct workspace when run inside a pane.

### Publish status and attention

```bash
shepherd set-status "running tests"
shepherd notify --title "Claude" --body "needs your attention"
shepherd log "integration suite started"
shepherd report-usage --input-tokens 1200 --output-tokens 340 --accuracy exact
```

### Control the workspace

```bash
shepherd list-workspaces
shepherd new-workspace --name api
shepherd new-split right
shepherd send-text "npm test"
shepherd send-key enter
shepherd rename-workspace --workspace api --name backend
```

### Create an isolated worktree workspace

```bash
shepherd new-worktree \
  --repo /absolute/path/to/repo \
  --path /absolute/path/to/worktree \
  --new-branch feat/example \
  --name example
```

### Observe and control agents

```bash
shepherd list-agents --state working,blocked
shepherd agent-snapshot --provider codex,claude
shepherd watch-agents
shepherd focus-agent <agent-id>
shepherd inspect-agent <agent-id> --lines 80
shepherd wait-agent <agent-id> --state done --timeout-ms 600000
```

Use `shepherd --help` for the full command and filter reference. The deprecated
`cmux` launcher and `CMUX_*` environment names remain available temporarily for
existing integrations; new scripts should use `shepherd` and `SHEPHERD_*`.

## How It Works

```text
terminal input
  → secure preload bridge
  → Electron main process
  → node-pty and the real shell
  → bounded output stream
  → xterm.js renderer

agent process or provider hook
  → automatic discovery or `shepherd` CLI
  → Unix-socket protocol
  → validated workspace and agent state
  → React sidebar, notifications, and exact-terminal navigation

workspace-owned local server
  → bounded Linux process and socket discovery
  → explicit localhost selection
  → isolated, loopback-only preview surface
```

The Electron main process owns privileged operations: PTYs, Linux process
inspection, persistence, worktrees, external-link validation, the socket server,
and OS notifications. The renderer owns presentation and pure workspace/layout
state. A restricted preload bridge exposes only the typed IPC surface required
by the UI.

Read [Architecture](docs/ARCHITECTURE.md) for the process boundaries and data
flows, [Workbench](docs/WORKBENCH.md) for the shipped interaction model,
[Appearance](docs/APPEARANCE.md) for theme behavior, and
[Accessibility](docs/ACCESSIBILITY.md) for keyboard and assistive-technology
behavior.

## Technology

- **Electron** — Linux desktop application and privileged main process
- **React + TypeScript** — workspace, sidebar, tab, and pane UI
- **xterm.js** — terminal emulation and WebGL rendering
- **node-pty** — real interactive shell processes
- **electron-vite** — development and production bundling
- **electron-builder** — AppImage and `.deb` packaging

## Development

```bash
npm install          # install dependencies
npm run dev          # launch with renderer hot reload
npm test             # run all executable TypeScript and CLI tests
npm run lint         # check JavaScript, TypeScript, and TSX
npm run typecheck    # validate main/preload and renderer projects
npm run build        # typecheck and build production bundles
npm run dist         # build AppImage and .deb artifacts in release/
```

Before submitting a pull request, run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Do not commit generated output from `out/` or `release/`. See
[AGENTS.md](AGENTS.md) for the repository's feature-delivery, testing,
documentation, commit, and pull-request conventions.

## Repository Guide

```text
src/main/          Electron main process: PTYs, socket API, agents, persistence
src/preload/       restricted IPC bridge exposed to the renderer
src/renderer/src/  React UI, state reducers, layout tree, and terminal views
src/shared/        shared IPC and protocol contracts
bin/               `shepherd` CLI and temporary compatibility launcher
benchmarks/        terminal performance and lifecycle harnesses
bug-fixes/         public write-ups for resolved foundational defects
build/             packaging assets
docs/              shipped feature, architecture, appearance, and accessibility notes
docs/images/       native application screenshots
```

Useful starting points:

- [PRODUCT.md](PRODUCT.md) — product definition, positioning, and pitch
- [docs/WORKBENCH.md](docs/WORKBENCH.md) — terminal workbench and attention model
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — process boundaries and data flow
- [docs/APPEARANCE.md](docs/APPEARANCE.md) — chrome and terminal theme behavior
- [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) — keyboard and accessibility notes
- [docs/INSTALLATION.md](docs/INSTALLATION.md) — packages, checksums, and uninstall steps
- [CHANGELOG.md](CHANGELOG.md) — shipped changes by release
- [AGENTS.md](AGENTS.md) — repository workflow and contribution conventions
- [benchmarks/README.md](benchmarks/README.md) — performance methodology and usage
- [bug-fixes/README.md](bug-fixes/README.md) — resolved bug write-ups

## Project Status

The core runtime milestones are complete: real terminals, workspaces, tabs,
splits, socket automation, semantic and automatic agent discovery, worktree
creation, live Git context, session restore, bounded terminal flow, terminal
lifecycle ownership, safe clickable links, a notification center, terminal
utilities, pull-request and port context, and localhost preview.

The current interface uses the compact workspace rail, actionable Attention
section, categorized appearance settings, terminal-first pane chrome, and
contextual workspace inspector described above. Shepherd remains early software;
the release page and this README are the source of truth for shipped behavior.

## Origin and License

Shepherd began because [cmux](https://cmux.com) did not have a Linux version. It
now has an independent product identity and is evolving beyond parity while
retaining attribution to that original inspiration.

Shepherd is an independent implementation and is not affiliated with cmux or
derived from its source.

Released under the [MIT License](LICENSE). Copyright © 2026 Anirudh S J.
