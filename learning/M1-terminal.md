# M1 — A Real Terminal (deep dive)

> **The goal of M1:** put a **real, working shell** inside the app. You type in the
> window, a real `bash` runs your command, and the output appears — exactly like a
> normal terminal. This is the **make-or-break milestone**: it exercises the entire
> renderer ↔ preload ↔ IPC ↔ main ↔ node-pty spine at once. If a terminal works,
> the hardest part of the whole project is done.

Pairs with `../textbook/` chapters `02` (how terminals work), `06` (node-pty),
`07` (xterm.js), `04` (IPC), `05` (preload), `17` (how it all connects). This file
explains **our specific M1 code**, function by function.

---

## 1. The big idea (read this first)

A terminal in cmux-linux is split across the two processes:

```
   RENDERER (Chromium)                                MAIN (Node.js)
 ┌────────────────────────┐                        ┌────────────────────────┐
 │ xterm.js  (the picture) │                        │ node-pty (the real shell)│
 │  • draws text/colors    │  ── keystrokes ──►     │  • spawns bash           │
 │  • captures keystrokes  │     (IPC)              │  • writes to its stdin   │
 │  • writes output to     │  ◄── output bytes ──   │  • streams its stdout    │
 │    screen               │     (IPC)              │                          │
 └────────────────────────┘                        └────────────────────────┘
        TerminalView.tsx          preload/index.ts          main/pty.ts
```

**xterm.js is a puppet; the real bash lives in the backend.** Everything in M1
serves that one sentence.

---

## 2. What we added / changed

```
src/
├── shared/
│   └── ipc.ts                     ★ NEW — the IPC contract (channels + types)
├── main/
│   ├── index.ts                   ~ edited — register pty IPC, kill on quit
│   └── pty.ts                     ★ NEW — the PtyManager (spawns/pipes shells)
├── preload/
│   └── index.ts                   ~ rewritten — expose window.api.terminal
└── renderer/src/
    ├── App.tsx                    ~ edited — render <TerminalView/>
    ├── App.css                    ~ edited — make the terminal fill the work area
    ├── env.d.ts                   ~ edited — window.api now typed by CmuxApi
    └── components/
        └── TerminalView.tsx       ★ NEW — one xterm.js terminal, wired over IPC
```

Plus dependencies: `@xterm/xterm`, `@xterm/addon-fit`, `node-pty` (runtime) and
`@electron/rebuild` (dev). And a one-time native rebuild (see §8).

---

## 3. `src/shared/ipc.ts` — one contract, three consumers

Main, preload, and renderer all import this file so they can't disagree about
channel names or message shapes. Two halves:

- **`IPC` constants** — the channel name strings, grouped by direction:
  ```ts
  TERM_CREATE: 'terminal:create',   // renderer → main (invoke/handle)
  TERM_INPUT, TERM_RESIZE, TERM_DISPOSE, // renderer → main (send/on)
  TERM_DATA, TERM_EXIT              // main → renderer (webContents.send)
  ```
  Using constants (not raw strings) means a typo is a *compile error*, not a
  silently-dead channel.
- **Payload interfaces** — `TermCreateOptions`, `TermInput`, `TermResize`,
  `TermData`, `TermExit`, and the big one: **`CmuxApi`**, the shape of
  `window.api`. Preload *implements* `CmuxApi`; the renderer *sees* it via
  `env.d.ts`. One source of truth (textbook/09).

> **🔧 Why a shared file:** in M0 the api type was duplicated in `env.d.ts`. As
> the surface grows (M2 adds splits, M3 adds workspaces), duplication would drift.
> Now there's exactly one definition and TypeScript enforces all three sides match.

---

## 4. `src/main/pty.ts` — the backend half (function by function)

This is where the *real shells* live. Key pieces:

- **`const terminals = new Map<string, pty.IPty>()`** — one live shell per
  terminal id. A Map (not a single variable) because M2 will have many; M1 just
  happens to use one entry.
- **`defaultShell()`** — returns `$SHELL` if set, else `bash` (else PowerShell on
  Windows). So it respects whatever shell you use.
- **`currentEnv()`** — copies `process.env` into a clean `{ [k]: string }`,
  dropping `undefined` values (node-pty's types want strings). The child shell
  inherits your environment (PATH, etc.) so commands resolve normally.
- **`createTerminal(sender, opts)`** — the heart:
  ```ts
  const proc = pty.spawn(defaultShell(), [], {
    name: 'xterm-color', cols, rows, cwd: opts.cwd || homedir(), env: currentEnv()
  })
  terminals.set(opts.id, proc)
  proc.onData((data) => sender.send(IPC.TERM_DATA, { id, data }))   // output → UI
  proc.onExit(({ exitCode }) => { sender.send(IPC.TERM_EXIT, …); terminals.delete(id) })
  ```
  - `sender` is the *WebContents that asked* — so output goes back to the right
    window (matters once there are many windows).
  - `sender.isDestroyed()` guards every send: if the window closed, we don't try
    to message a dead renderer (that would throw).
- **`registerPtyIpc()`** — wires the four inbound channels to the Map:
  | Channel | Handler | What it does |
  |---|---|---|
  | `TERM_CREATE` | `ipcMain.handle` | spawn a shell (request/response) |
  | `TERM_INPUT` | `ipcMain.on` | `terminals.get(id)?.write(data)` — keystrokes in |
  | `TERM_RESIZE` | `ipcMain.on` | `.resize(cols, rows)` — so `vim` etc. fit |
  | `TERM_DISPOSE` | `ipcMain.on` | `.kill()` + remove from Map |
  The `?.` (optional chaining) means a message for an unknown id is a safe no-op,
  not a crash.
- **`killAllTerminals()`** — loops the Map and kills every shell. Called on quit so
  we never leak **zombie processes** (textbook/06 §gotchas).

> **⚠️ Gotcha we handled:** without `killAllTerminals()` on quit, every run would
> leave an orphaned `bash` behind. Try `ps aux | grep bash` after quitting to
> confirm none linger.

---

## 5. `src/main/index.ts` — three small edits

1. `import { registerPtyIpc, killAllTerminals } from './pty'`
2. In `app.whenReady()` → **`registerPtyIpc()`** *before* creating the window, so
   the handlers exist by the time the renderer sends anything.
3. In `window-all-closed` **and** a new `before-quit` handler → **`killAllTerminals()`**.

That's the entire main-process change — the window code from M0 is untouched.

---

## 6. `src/preload/index.ts` — the typed bridge

Now `window.api` has a `terminal` namespace implementing `CmuxApi`:

- **`create`** → `ipcRenderer.invoke(TERM_CREATE, opts)` (async request/response).
- **`input` / `resize` / `dispose`** → `ipcRenderer.send(...)` (fire-and-forget).
- **`onData(id, cb)`** — the clever bit. Main broadcasts *all* terminal output on
  one `TERM_DATA` channel tagged with an id. This filters to just *your* id:
  ```ts
  const listener = (_e, msg) => { if (msg.id === id) cb(msg.data) }
  ipcRenderer.on(IPC.TERM_DATA, listener)
  return () => ipcRenderer.removeListener(IPC.TERM_DATA, listener)  // ← unsubscribe
  ```
  It **returns an unsubscribe function** — React's `useEffect` cleanup calls it so
  listeners don't pile up (textbook/05 + /08).
- **`onExit`** — same pattern for the exit event.

The renderer still only ever touches `window.api` — never `ipcRenderer`. Security
intact (textbook/05).

---

## 7. `src/renderer/src/components/TerminalView.tsx` — the UI half

One component = one terminal. Everything happens inside a single `useEffect` (runs
once on mount), in **seven numbered steps** — read them in the file, but here's the
why:

1. **Create `Terminal` + `FitAddon`, `term.open(container)`** — xterm paints into
   our `div` (held in a `useRef`, *not* state, so React never re-renders it —
   textbook/08).
2. **`const id = crypto.randomUUID()`** — the handle that ties this xterm to one
   backend shell.
3. **Subscribe to output BEFORE step 4** — `onData`/`onExit` are registered first
   so we can't miss the shell's very first prompt bytes.
4. **`window.api.terminal.create({ id, cols, rows })`** — ask the backend to spawn
   the shell at our current size.
5. **`term.onData(d => …input({ id, data: d }))`** — keystrokes → shell.
6. **`ResizeObserver` → `fit.fit()` + `…resize(...)`** — when the window/pane
   resizes, recompute cols/rows and tell the shell (so full-screen apps render
   correctly — textbook/02 §SIGWINCH).
7. **Cleanup (the `return`)** — disconnect the observer, dispose the input
   listener, unsubscribe `onData`/`onExit`, **kill the shell**, dispose xterm.
   Order matters: unsubscribe before killing so we don't render a stray
   "process exited" line during teardown.

> **🔧 Why an id per component instead of "the one terminal":** it costs nothing now
> and means M2 (many terminals) just renders many `<TerminalView/>`s — no rewrite.

---

## 8. The native-module story (why we ran a rebuild)

`node-pty` is a **native C++ addon** — it ships a compiled `pty.node` binary. But
it's compiled for *Node's* ABI, and **Electron uses a different ABI** (it embeds
its own Node). So the stock binary won't load inside Electron.

Fix (a one-time step, textbook/06 + /14):
```bash
npx electron-rebuild -f -w node-pty
```
`@electron/rebuild` recompiled `node-pty` against Electron 43's ABI →
`node_modules/node-pty/build/Release/pty.node`. `electron.vite.config.ts`'s
`externalizeDepsPlugin()` keeps it *out* of the bundle so Electron `require`s the
real binary at runtime.

> **⚠️ Gotcha for later:** after upgrading Electron, or on a fresh `npm install`,
> re-run the rebuild. (In M6 we'll wire this into packaging so it's automatic.)

---

## 9. The life of one keystroke (the payoff)

Type `l` in the terminal:
```
term.onData('l')                         [TerminalView, step 5]
 → window.api.terminal.input({id,'l'})   [preload]
 → ipcRenderer.send(TERM_INPUT)          [IPC]
 → ipcMain.on(TERM_INPUT)                [pty.ts]
 → terminals.get(id).write('l')          [node-pty → real bash stdin]
```
bash echoes it back / runs your command; output returns:
```
proc.onData('l  file1 file2\n')          [pty.ts]
 → sender.send(TERM_DATA,{id,data})      [IPC push]
 → preload listener filters by id        [preload onData]
 → term.write(data)                      [TerminalView]
 → xterm parses ANSI, paints glyphs      [you SEE it]
```
That round trip — proven end-to-end — is M1. (Full narration: textbook/17.)

---

## 10. What's intentionally minimal / deferred

- **One terminal only.** The structure (id-keyed Map, per-component id) is already
  multi-terminal ready; M2 adds tabs + splits.
- **No WebGL renderer yet.** We use xterm's default renderer for M1 robustness;
  the `@xterm/addon-webgl` perf boost comes in a later pass (M6).
- **No scrollback restore, no sidebar wiring** — M3/M4.
- **React StrictMode double-mounts effects in dev**, so on `npm run dev` a shell is
  briefly spawned+killed once at startup. Harmless (our cleanup handles it); it
  doesn't happen in the production build.

---

## 11. How to run it & what you should see

```bash
npm run dev
```
A window opens with the sidebar on the left and a **working terminal** on the
right. Click it and:
- type `ls` → see your files
- type `pwd`, `echo hi`, run `vim` → it all works, colors and all
- resize the window → the terminal reflows

Verify no zombies after quitting: `ps aux | grep -w bash` should show nothing left
over from the app.

---

## 🧪 Checkpoint

1. Which process runs the real `bash` — and which library draws the terminal?
2. `onData` in preload filters by `id`. Why is that needed (hint: one channel,
   many terminals)?
3. Why must `node-pty` be rebuilt with `electron-rebuild`?
4. What two bad things does `TerminalView`'s cleanup function prevent?
5. Trace the path of the letter `l` from keypress to pixels (name each hop).

---

## Next: M2 — many terminals, tabs & splits
We generalize today's single `<TerminalView/>` into a **Pane → Surface** tree:
multiple terminals, per-pane tabs (surfaces), and horizontal/vertical splits.
See `../textbook/10-tiling-and-layout.md` and `../FEATURES.md` Part 1.
