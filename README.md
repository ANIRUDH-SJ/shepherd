# cmux-linux

A Linux desktop recreation of [cmux](https://cmux.com) — *the terminal built for
multitasking with AI agents*. cmux is a native macOS app; this is an open-source
Linux equivalent built on web technologies.

Vertical named sidebar with live per-agent status, notification rings when an
agent needs you, split terminal panes, and a socket API for automation.

> **Status: early development.** Milestones **M0–M5** are complete — real shells in
> split panes, a workspace sidebar, OSC notifications, session restore, and the
> unix-socket control API. **M6** (polish & packaging) is in progress. See
> `ROADMAP.md` for the plan and `learning/` for a running, plain-English log of
> what each milestone built.

## Stack

- **Electron** — desktop shell (Node.js main process + Chromium renderer)
- **React + TypeScript** — the UI (sidebar, tabs, tiled panes)
- **xterm.js** — terminal rendering, GPU-accelerated via its WebGL addon
- **node-pty** — real shells behind the terminals
- **electron-vite** — build tooling / hot reload
- **electron-builder** — AppImage / `.deb` packaging

## Install

Grab an artifact from the releases page, or build one yourself (below).

**AppImage** — no install, runs anywhere:

```bash
chmod +x cmux-linux-*.AppImage
./cmux-linux-*.AppImage
```

**Debian / Ubuntu:**

```bash
sudo apt install ./cmux-linux_*_amd64.deb
cmux-linux            # or launch it from your app menu
```

## Usage

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+D` / `E` | split right / down |
| `Ctrl+Shift+T` | new tab |
| `Ctrl+Shift+N` | new workspace |
| `Ctrl+Shift+W` | close surface |
| `Ctrl+Shift+B` | toggle sidebar |
| `Ctrl+Shift+=` / `-` / `0` | zoom terminal in / out / reset |
| `F2` on a workspace | rename workspace (`Enter` saves, `Escape` cancels) |

You can also right-click a workspace and choose **Rename workspace**, double-click
its name, or use its pencil action. Submitting an empty name returns to positional
labels such as `workspace 2`.

Every pane gets a `cmux` command on its `PATH`, which drives the app over its
unix socket — this is how an agent reports status back to the sidebar:

```bash
cmux set-status "running tests"
cmux notify --title Claude --body "needs your attention"
cmux rename-workspace --workspace "workspace 1" --name build
cmux hooks setup      # install a Claude Code notify hook
cmux --help
```

## Develop

```bash
npm install      # install dependencies
npm run dev      # launch the app with hot reload
npm run build    # typecheck + build production bundles
npm test         # headless logic tests
npm run lint     # lint
npm run format   # prettier
npm run dist     # package an AppImage + .deb into release/
```

## Repository layout

```
cmux-linux/
├── src/
│   ├── main/          # Electron main process (Node backend)
│   ├── preload/       # the secure window.api bridge
│   └── renderer/      # the React app (UI)
├── bin/               # the `cmux` CLI shipped onto every pane's PATH
├── build/             # packaging assets (app icon)
├── electron-builder.yml  # AppImage / .deb packaging config
├── textbook/          # deep textbook: how the project + every tech works
├── learning/          # as-we-build log — what each milestone actually added
├── ROADMAP.md         # milestones M0–M6
├── FEATURES.md        # cmux feature parity map + object model + socket API
├── LEARNING.md        # Electron study plan
└── REFRESHER.md       # React / Node / CSS refresher
```

## License

MIT © 2026 Anirudh S J. Inspired by cmux (manaflow-ai/cmux); this is an
independent implementation, not affiliated with or derived from cmux's source.
