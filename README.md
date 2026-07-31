# Shepherd

Shepherd is an open-source, AI-native terminal workspace for Linux. It combines
real shells, tiled panes, per-pane tabs, live project and Git context, automatic
agent discovery, semantic agent status, and a Unix-socket automation API.

The project began because [cmux](https://cmux.com) did not have a Linux version.
Shepherd now has its own product identity and is evolving beyond parity while
retaining attribution to that original inspiration.

Vertical named sidebar with live project/branch context and per-agent status,
notification rings when an agent needs you, split terminal panes, and a socket
API for automation.

> **Status: early development.** Core runtime milestones **M0–M5** and **M7–M15**
> are complete — real shells, split panes, live workspace/Git context, automatic
> agent discovery, session restore, and the Unix-socket API. **M6** (polish &
> packaging) is in progress. See
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

Grab an artifact from the
[GitHub releases page](https://github.com/ANIRUDH-SJ/shepherd/releases), or build
one yourself.

**AppImage** — no installation:

```bash
chmod +x Shepherd-*.AppImage
./Shepherd-*.AppImage
```

**Debian / Ubuntu:**

```bash
sudo apt install ./Shepherd_*_amd64.deb
shepherd             # or launch Shepherd from the app menu
```

## Usage

| Shortcut                   | Action                                             |
| -------------------------- | -------------------------------------------------- |
| `Ctrl+Shift+D` / `E`       | split right / down                                 |
| `Ctrl+Shift+T`             | new tab                                            |
| `Ctrl+Shift+N`             | new workspace                                      |
| `Ctrl+Shift+W`             | close surface                                      |
| `Ctrl+Shift+B`             | toggle sidebar                                     |
| `Ctrl+Shift+=` / `-` / `0` | zoom terminal in / out / reset                     |
| `F2` on a workspace        | rename workspace (`Enter` saves, `Escape` cancels) |

When a terminal tab has keyboard focus, Left/Right wraps across tabs, Home/End
jumps to the first or last tab in that pane, and Delete closes the focused tab.

You can also right-click a workspace and choose **Rename workspace**, double-click
its name, or use its pencil action. Submitting an empty name returns to the live
project name, with a positional label such as `Workspace 2` as context.

Each launch begins with one workspace. If the previous session had several,
Shepherd resumes only the workspace that was active at shutdown, including its
latest cwd, tabs, panes, and split layout.

Every pane gets a `shepherd` command on its `PATH`. It drives the app over
`/tmp/shepherd.sock`, including agent status and automation:

```bash
shepherd set-status "running tests"
shepherd notify --title Claude --body "needs your attention"
shepherd rename-workspace --workspace "workspace 1" --name build
shepherd integrations setup
shepherd --help
```

The deprecated `cmux` launcher and `CMUX_*` environment names remain available
for existing scripts during the compatibility window. New integrations should
use `shepherd` and `SHEPHERD_*`.

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
shepherd/
├── src/
│   ├── main/          # Electron main process (Node backend)
│   ├── preload/       # the secure window.api bridge
│   └── renderer/      # the React app (UI)
├── bin/               # primary `shepherd` CLI plus compatibility launcher
├── build/             # packaging assets (app icon)
├── electron-builder.yml  # AppImage / .deb packaging config
├── textbook/          # deep textbook: how the project + every tech works
├── learning/          # as-we-build log — what each milestone actually added
├── ROADMAP.md         # milestones M0–M6
├── FEATURES.md        # feature map, object model, and socket API
├── LEARNING.md        # Electron study plan
└── REFRESHER.md       # React / Node / CSS refresher
```

## License

MIT © 2026 Anirudh S J. Shepherd is an independent implementation inspired by
cmux and is not affiliated with or derived from cmux's source.
