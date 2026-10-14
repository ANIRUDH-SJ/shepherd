# Changelog

## Unreleased

### Notification delivery

- Added global desktop-alert modes, local-time quiet hours, and per-workspace
  routing overrides without suppressing the in-app notification inbox.
- Desktop alerts now reopen Shepherd and select the relevant workspace when
  clicked; closed-workspace overrides are pruned.

### Workspace templates

- Added local workspace templates with a native repository-folder picker and
  optional setup/run commands.
- Commands launch only from explicit inspector actions in fresh terminal tabs;
  session restoration never replays them.

### Change review

- Added an on-demand repository review panel with changed files, separate staged
  and working diffs, whole-file stage/unstage actions, and staged-file commits.
- Added explicit `npm test` execution with bounded output and the current
  branch's pull-request diff when GitHub CLI access is available.
- Bound review actions to the requesting renderer's live terminal and revalidate
  the Git root and selected path before each operation.

### Sessions

- Restore all workspaces, their layouts, and their bounded notification inboxes
  on launch, while starting fresh shells and clearing ephemeral agent state.
- Keep terminals alive after window close where a system tray is available;
  expose Show and Quit actions in the tray.
- Replace session snapshots atomically and flush the latest layout on quit.

### Workbench

- Aligned the shell with cmux's compact hierarchy: a stable workspace titlebar,
  dedicated pane tab rows, flat pane boundaries, and restrained always-available
  pane actions.
- Added a one-time terminal-first welcome for fresh profiles, replayable with
  `shepherd welcome`.

### Appearance

- Replaced the Graphite preference with a System terminal palette that follows
  the application's resolved light or dark surfaces.
- Adopted neutral `#1e1e1e` and `#feffff` foundations with a focused blue accent
  for selection and keyboard focus.

## 0.1.0 — 2026-09-03

Shepherd 0.1.0 establishes the terminal-first workbench and appearance system.

### Workbench

- Replaced metadata-heavy workspace cards with a compact two-line workspace rail.
- Added a dedicated Attention section for actionable blocks and unseen
  completions.
- Integrated workspace identity into the first pane tab bar, reclaiming terminal
  rows.
- Added a contextual workspace inspector for repository, pull request, owned
  ports, agents, usage, and session structure.
- Preserved exact agent-to-terminal focus, keyboard navigation, notification
  routing, workspace renaming, splits, tabs, and secure localhost previews.

### Appearance and interaction

- Added versioned renderer preferences with migration from earlier font-size
  settings.
- Added System, Light, and Dark application appearance through Electron's native
  theme bridge.
- Kept application chrome independent from the Graphite xterm ANSI palette.
- Reorganized Settings into Appearance, Terminal, Keyboard, Notifications,
  Workspaces, Agents, and Advanced categories.
- Normalized pane focus, tab close behavior, control sizes, spacing, and
  accessibility names.

### Reliability

- Re-probe Git metadata when the active terminal surface changes.
- Wait for Electron webview DOM readiness before applying preview audio state.
- Added regression coverage for preferences, themes, attention derivation,
  inspector summaries, metadata ownership, and command discovery.

## 0.0.1 — 2026-08-05

Initial Linux developer preview with real PTYs, workspaces, tabs, split panes,
agent reporting and discovery, socket automation, notifications, worktrees,
session restoration, terminal utilities, and AppImage and Debian packages.
