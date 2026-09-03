# Changelog

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
