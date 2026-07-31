# Shepherd — Learning Plan (Electron, from scratch)

A focused "learn just enough" path to build this project. It's ordered so each
topic unlocks the next milestone in `ROADMAP.md` — **you don't need to learn all
of Electron, only the slice this app uses.** Don't binge tutorials up front;
learn each block right before the milestone that needs it.

Time estimates assume you're comfortable with JS/React/Node already.

---

## ✅ What you already know (skip these)

These map almost 1:1 from your existing skills, so don't re-study them:

- **React + components + hooks** → the entire renderer/UI is this.
- **Node `fs`, `net`, `child_process`** → the main process is just Node.
- **npm / package.json / bundlers** → tooling is familiar.
- **CSS / flexbox** → the layout (sidebar + panes) is plain CSS.
- **Express request/response thinking** → IPC is the same mental model.

Your only real gaps are: **the Electron 2-process model + IPC**, **node-pty**,
and **xterm.js**. That's it. Everything else you already have.

---

## Block 0 — TypeScript (light) ⏱ ~2–3 hrs (only if rusty)

_Needed from M0 onward. The template is TS; you mostly just add type annotations._

- [ ] Basic types, interfaces, `type` aliases
- [ ] Typing function params/returns, optional props
- [ ] Typing React props/state (`useState<T>`, component prop interfaces)
- [ ] Skip the advanced stuff (generics deep-dive, conditional types) for now
- 📚 _TypeScript Handbook → "The Basics" + "Everyday Types"; the React+TS cheatsheet_

> If you already write TS, skip this entirely.

---

## Block 1 — Electron core architecture ⏱ ~3–4 hrs

_This is THE foundational concept. Needed for M0–M1. Most important block._

- [ ] **Main process vs Renderer process** — what runs where, and why they're separate - Main = Node, full OS access ("the backend") - Renderer = Chromium tab running your React app ("the frontend"), sandboxed
- [ ] **`BrowserWindow`** — creating a window, loading your app, window options
- [ ] **`app` lifecycle events** — `ready`, `window-all-closed`, `activate`, quitting cleanly
- [ ] Why the renderer can't directly use Node (security: `contextIsolation`,
      `nodeIntegration: false`) — and why that's a good thing
- [ ] Mental model lock-in: _main = Express backend, renderer = React frontend_
- 📚 _Electron docs → "Process Model" + "Tutorial" parts 1–2_
- 🛠 **Exercise:** open a window that loads a static React page. (This basically = M0.)

---

## Block 2 — IPC: how the two processes talk ⏱ ~3–4 hrs

_The single most important Electron skill for this app. Needed for M1._

- [ ] **`ipcMain.handle()` + `ipcRenderer.invoke()`** — async request/response
      (this is your "API call"; use this 90% of the time)
- [ ] **`ipcMain.on()` + `ipcRenderer.send()`** — fire-and-forget messages
- [ ] **`webContents.send()` + `ipcRenderer.on()`** — push FROM main TO renderer
      (you'll use this to stream pty output to the terminal)
- [ ] When to use which (request/response vs streaming events)
- 📚 _Electron docs → "Inter-Process Communication" (read the whole page)_
- 🛠 **Exercise:** button in React → calls main → main returns the OS username → show it.

---

## Block 3 — Preload + contextBridge (the secure door) ⏱ ~2 hrs

_The safe way to expose main-process functions to React. Needed for M1._

- [ ] What a **preload script** is and why it exists
- [ ] **`contextBridge.exposeInMainWorld()`** — exposing a tidy `window.api` object
- [ ] How `contextIsolation` keeps the renderer sandboxed
- [ ] The standard pattern: preload wraps `ipcRenderer` calls into named functions
- 📚 _Electron docs → "Context Isolation" + the preload section of the IPC page_
- 🛠 **Exercise:** expose `window.api.getUsername()` from preload; call it in React.

---

## Block 4 — node-pty (real shells) ⏱ ~2–3 hrs

_The heart of a terminal app. Needed for M1._

- [ ] What a **PTY** (pseudo-terminal) is, conceptually
- [ ] `pty.spawn(shell, args, { cols, rows, cwd, env })`
- [ ] Reading output: the `onData` event (a stream of bytes/strings)
- [ ] Writing input: `ptyProcess.write(data)`
- [ ] Resizing: `ptyProcess.resize(cols, rows)`
- [ ] Cleanup: `ptyProcess.kill()` on window/pane close (avoid zombie processes)
- [ ] Note: node-pty is a **native module** — only runs in the main process,
      and may need a rebuild for your Electron version (`electron-rebuild`)
- 📚 _node-pty README (it's short); skim its examples folder_
- 🛠 **Exercise (in main only):** spawn bash, write `ls\n`, log the output.

---

## Block 5 — xterm.js (the terminal UI) ⏱ ~3–4 hrs

_Renders the terminal in the browser. Needed for M1, deepened in M2/M6._

- [ ] Creating a `Terminal`, `.open(domElement)` to mount it
- [ ] `.write(data)` to display output; `.onData(cb)` to capture keystrokes
- [ ] **FitAddon** — auto-size the terminal to its container
- [ ] **WebGL addon** — GPU rendering for smooth scrolling (perf, M6)
- [ ] Mounting xterm inside a **React component** (refs + `useEffect`, cleanup)
- [ ] Theming (colors, font, cursor) to match cmux later
- 📚 _xterm.js docs/guides + the "getting started" example_
- 🛠 **Exercise:** mount an xterm in React; echo whatever you type back into it.

---

## 🔗 The "aha" integration (end of M1)

Once Blocks 1–5 click, wire them into the core loop — this is the whole app in miniature:

```
keystroke in xterm (renderer)
   → preload window.api.sendInput(paneId, data)
   → ipcRenderer.invoke → ipcMain.handle (main)
   → ptyProcess.write(data)
   → shell runs it, emits output via pty.onData (main)
   → webContents.send('pty-data', {paneId, data})
   → ipcRenderer.on('pty-data') (renderer)
   → term.write(data)  ← you see the result
```

If you can build that round-trip, you understand 80% of this project.

---

## Block 6 — electron-vite tooling ⏱ ~1–2 hrs

_Project scaffolding + dev experience. Needed at M0._

- [ ] What `electron-vite` gives you (Vite for renderer + bundling main/preload)
- [ ] The `main/ preload/ renderer/` folder layout
- [ ] `npm run dev` (hot reload) vs `npm run build`
- [ ] `electron.vite.config.ts` basics
- 📚 _electron-vite docs → "Getting Started"_

---

## Block 7 — Packaging & distribution ⏱ ~2–3 hrs (LATER — only at M6)

_Don't learn this now. Bookmark it for the packaging milestone._

- [ ] `electron-builder` config in package.json
- [ ] Linux targets: **AppImage**, **.deb**, **Flatpak**
- [ ] App icon, app id, artifact naming
- [ ] Code-signing/auto-update (optional, much later)
- 📚 _electron-builder docs → "Linux" target section_

---

## Cross-cutting: Electron security checklist ⏱ ~1 hr

_Read once early; it shapes how you write IPC/preload._

- [ ] `contextIsolation: true`, `nodeIntegration: false` (defaults — keep them)
- [ ] Never expose raw `ipcRenderer` to the renderer; wrap specific functions
- [ ] Validate/whitelist IPC channel names and payloads in main
- 📚 _Electron docs → "Security" checklist_

---

## Suggested schedule (part-time, ~1–2 hrs/evening)

| Days | Study                             | Then build      |
| ---- | --------------------------------- | --------------- |
| 1    | Block 1 (architecture)            | —               |
| 2    | Block 6 + Block 2 (tooling + IPC) | start **M0**    |
| 3    | Block 3 (preload)                 | finish **M0**   |
| 4    | Block 4 (node-pty)                | —               |
| 5    | Block 5 (xterm.js)                | —               |
| 6–7  | re-read the integration diagram   | build **M1** 🎉 |

After M1, you've learned everything Electron-specific. M2–M6 are mostly React,
Node, and CSS work you already know — you learn the rest _as you hit it_.

---

## Golden rules while learning

1. **Learn each block right before its milestone**, not all up front.
2. **The integration loop (M1) is the real test** — if it works, you "get" Electron.
3. **Don't over-engineer early.** One window, one terminal, then grow.
4. When stuck, the official **Electron docs** are excellent — prefer them over
   random blog posts (Electron's API changes fast and posts go stale).
5. Keep the mental model: _main = backend, renderer = frontend, IPC = the API._

---

## Primary resources (bookmark these)

- Electron docs — https://www.electronjs.org/docs/latest
- electron-vite — https://electron-vite.org/
- xterm.js — https://xtermjs.org/
- node-pty — https://github.com/microsoft/node-pty
- electron-builder — https://www.electron.build/
- React + TypeScript cheatsheet — https://react-typescript-cheatsheet.netlify.app/
