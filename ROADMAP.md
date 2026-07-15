# cmux-linux — Build Roadmap

A Linux desktop recreation of [cmux](https://cmux.com/) (Mac-only) — the terminal
built for running multiple AI coding agents side by side, with a vertical named
sidebar, status subtitles, notification rings, split panes, and a socket API.

**Stack:** Electron + xterm.js + node-pty + React + TypeScript + Vite.

- **Renderer (UI):** React + TypeScript + CSS — sidebar, tabs, tiled panes.
- **Terminals:** xterm.js (+ fit, webgl, search addons).
- **PTY / shells:** node-pty in the Electron main process.
- **Backend (main process):** Node — window lifecycle, pty management,
  state-dir file watching (chokidar), unix-socket automation API.
- **Bridge:** Electron IPC + preload `contextBridge`.
- **Build/package:** Vite + electron-builder → AppImage / .deb / Flatpak.

**Mental model:** main process = "the Express backend", renderer = "the React
frontend", IPC = "the API calls between them".

---

## Progress at a glance

- [x] **M0** — Project setup & scaffolding ✓
- [x] **M1** — Window shell: sidebar + one live terminal ✓
- [x] **M2** — Multiple terminals, tabs & split panes ✓
- [x] **M3** — The cmux sidebar (workspaces, status, notification rings) ✓
- [x] **M4** — Agent integration & session persistence ✓
- [x] **M5** — Socket API & automation (a real cmux feature) ✓
- [ ] **M6** — Polish, theming & packaging/distribution

---

> **Companion doc:** [`FEATURES.md`](./FEATURES.md) — the full cmux feature parity
> map, the real object model (Window→Workspace→Pane→Surface→Panel), and the socket
> API this roadmap now reflects. Read it alongside these milestones.

## M0 — Project setup & scaffolding
*Goal: an empty Electron + React + TS window that opens and hot-reloads.*

- [ ] Init repo: `git init`, add `.gitignore`, `LICENSE` (MIT), `README.md`
- [ ] Scaffold with `electron-vite` (Vite + Electron + React + TS template)
- [ ] Confirm the three-file structure: `main/`, `preload/`, `renderer/`
- [ ] Get an empty React window opening via `npm run dev`
- [ ] Verify hot-reload works for the renderer
- [ ] Set up ESLint + Prettier + TS strict mode
- [ ] Add npm scripts: `dev`, `build`, `lint`
- [ ] Commit the baseline

## M1 — Window shell: sidebar + one live terminal
*Goal: a window with a placeholder sidebar on the left and ONE terminal you can
actually type commands into. This is the make-or-break milestone — it teaches
the pty-over-IPC loop.*

- [ ] Install `xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`, `node-pty`
- [ ] Lay out the app shell: fixed-width sidebar + flexible main area (CSS)
- [ ] Render a static placeholder sidebar (hardcoded list items)
- [ ] **Main process:** spawn a shell with node-pty (`bash`/`$SHELL`)
- [ ] **Preload:** expose safe `onPtyData`, `sendPtyInput`, `resizePty` via `contextBridge`
- [ ] **Renderer:** mount an xterm.js instance into a React component
- [ ] Wire pty → xterm: stream pty `data` over IPC, write to terminal
- [ ] Wire xterm → pty: send `onData` keystrokes back to the shell
- [ ] Handle resize: FitAddon + send new cols/rows to node-pty
- [ ] Confirm: open the app, type `ls`, see output. 🎉
- [ ] Clean up pty process on window close (no zombies)
- [ ] Commit

## M2 — Multiple terminals, tabs & split panes
*Goal: open several terminals, organized into tabs, with horizontal/vertical
splits inside a tab — like cmux's panes.*

- [ ] Refactor: a `Terminal` React component keyed by a unique `paneId`
- [ ] Main process: manage a **map of ptyId → pty process** (not just one)
- [ ] IPC: include `paneId` in all pty messages so data routes correctly
- [ ] Inject `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` / `CMUX_SOCKET_PATH` into each pane's env
- [ ] App state model: **Workspace → Pane → Surface → Panel** tree (see FEATURES.md Part 1)
- [ ] Add a per-pane tab bar = **surfaces** (create / switch / close)
- [ ] Integrate a tiling layout for splits (`react-mosaic` or hand-rolled flex)
- [ ] Split commands: split-right / split-down within the active workspace
- [ ] Focus handling: clicking a pane focuses it; visible focus ring
- [ ] Close a single pane (kill its pty, collapse the layout)
- [ ] Keyboard shortcuts: new tab, close pane, split (define a keymap)
- [ ] Resize splits with the mouse (draggable dividers)
- [ ] Commit

## M3 — The cmux sidebar (the signature look)
*Goal: the left sidebar matches the screenshot — named workspaces, a status
subtitle per item, active highlight, and notification markers.*

- [ ] Define a "workspace" model (name, cwd, status, unread/attention flag)
- [ ] Build the sidebar React component to match cmux styling (dark theme)
- [ ] Active workspace highlight (blue selection block)
- [ ] Status subtitle line under each name ("Claude is waiting for your input")
- [ ] Notification markers: the `*` / dot + tab/row flash animation (CSS)
- [ ] Click a workspace → switch to its tab/pane group
- [ ] **State source = socket API:** stand up a minimal `net` unix-socket server in
      main handling `set-status` / `log` / `notify` — this is what feeds the sidebar
      (the full control API comes in M5). See FEATURES.md Part 2.
- [ ] Socket messages update workspace metadata → push to renderer via IPC → re-render
- [ ] (Optional fallback) also accept status from a watched state dir (`chokidar`)
- [ ] Sidebar: **resizable width (drag handle)** + collapse/expand toggle (cmux's sidebar button)
      — reuses the draggable-divider logic built for panes in M2
- [ ] Empty state + "new workspace" affordance (the `+` button)
- [ ] Commit

## M4 — Agent integration & session persistence
*Goal: real AI agents drive the sidebar status, and the workspace survives a
restart.*

- [ ] Define the status protocol: what an agent signals
      "waiting / running / done / needs attention"
- [ ] Ship the `cmux` CLI client (thin socket client) + a `cmux notify` shortcut
- [ ] **OSC 9/99/777 parser:** scan pty output in main → auto-fire notifications
- [ ] Wire Claude Code's `Notification` hook → `cmux notify` (via `cmux hooks setup`)
- [ ] Map incoming notifications to the right workspace (by `CMUX_WORKSPACE_ID` / cwd)
- [ ] Trigger the ring/flash + unread badge + a desktop notification (`Notification` API)
- [ ] **Persistence:** serialize tabs/panes/cwds + workspace list to JSON on change
- [ ] Restore the full layout on next launch (re-spawn shells in saved cwds)
- [ ] "Restore previous session?" vs fresh-start handling
- [ ] Commit

## M5 — Full socket control API (real cmux feature)
*Goal: expand the M3 socket server from status-only to full programmatic control,
mirroring cmux's method surface. Easier in Node than cmux's Swift version.*

- [ ] Adopt cmux's wire format: newline-terminated JSON `{id, method, params}` (FEATURES.md Part 2)
- [ ] `workspace.*` — create / list / select / current / close
- [ ] `surface.split` (left/right/up/down), `surface.list`, `pane.surfaces`, `surface.focus`
- [ ] `surface.send_text` / `surface.send_key` — drive a pane programmatically
- [ ] `set-progress` / `clear-progress`, `list-status`, `list-log`, `sidebar-state`
- [ ] `ping` / `capabilities` / `identify` utility methods
- [ ] Round out the `cmux` CLI to cover all methods; document the protocol
- [ ] Commit

## M6 — Polish, theming & packaging/distribution
*Goal: it looks finished and other people can install it.*

- [ ] Final theme pass to match cmux (colors, fonts, spacing, rings)
- [x] App icon + window title/branding
- [x] Persisted terminal font-size setting + zoom shortcuts
- [ ] Settings UI: theme, default shell, keybindings
- [x] xterm.js WebGL renderer enabled
- [ ] WebGL perf check (scroll, big output)
- [ ] Empty/error states, keyboard-shortcut cheat sheet
- [x] Configure `electron-builder` for **AppImage** and **.deb**
- [ ] Configure **Flatpak** packaging
- [x] Build AppImage and `.deb` artifacts
- [ ] Test-install on a clean Ubuntu
- [x] README install and usage instructions
- [ ] README screenshots
- [ ] (Optional) GitHub Actions CI: lint + build on push
- [ ] Tag a `v0.1.0` release

---

## Stretch / later (post-v1)

- [ ] Port the React UI to **Tauri** for lean binaries (~10× smaller, less RAM)
- [ ] PR status/number + listening ports per workspace (git branch lands in v1)
- [ ] In-app browser panels + browser automation API (`Panel='browser'`)
- [ ] Remote SSH workspaces + localhost routing; Claude Code Teams mode
- [ ] Worktree-per-workspace workflow (our value-add; cmux only shows the branch)
- [ ] Cross-platform builds (Windows/Mac) — Electron makes this nearly free
- [ ] Investigate libghostty embedding once its C API stabilizes (most authentic
      renderer — currently too unstable to depend on)

---

## Notes & decisions

- Chose **Electron over Tauri** for v1: same React UI, but bundled Chromium
  renders xterm.js canvas/WebGL more smoothly on Linux than WebKitGTK, and it's
  the fastest path on a React/Node skill set. UI ports to Tauri later near-free.
- Chose **Electron over libghostty embed**: libghostty is the renderer cmux
  itself uses, but its embedding C API is still unstable and it's Zig — wrong
  effort-to-payoff for now. Revisit at Level 3.
- The **state-dir + file-watch** pattern (M3/M4) is the backbone that makes
  agent statuses appear in the sidebar — design it early, everything hangs off it.
