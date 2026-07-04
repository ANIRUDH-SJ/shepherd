# cmux-linux

A Linux desktop recreation of [cmux](https://cmux.com) — *the terminal built for
multitasking with AI agents*. cmux is a native macOS app; this is an open-source
Linux equivalent built on web technologies.

Vertical named sidebar with live per-agent status, notification rings when an
agent needs you, split terminal panes, and a socket API for automation.

> **Status: early development.** Milestone **M0** (project scaffold) is complete —
> the Electron + React + TypeScript shell opens a window. See `ROADMAP.md` for the
> plan and `learning/` for a running, plain-English log of what each milestone built.

## Stack

- **Electron** — desktop shell (Node.js main process + Chromium renderer)
- **React + TypeScript** — the UI (sidebar, tabs, tiled panes)
- **xterm.js** — terminal rendering (arrives in M1)
- **node-pty** — real shells behind the terminals (arrives in M1)
- **electron-vite** — build tooling / hot reload

## Develop

```bash
npm install      # install dependencies
npm run dev      # launch the app with hot reload
npm run build    # typecheck + build production bundles
npm run lint     # lint
npm run format   # prettier
```

## Repository layout

```
cmux-linux/
├── src/
│   ├── main/          # Electron main process (Node backend)
│   ├── preload/       # the secure window.api bridge
│   └── renderer/      # the React app (UI)
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
