# M0 — Project Scaffold (deep dive)

> **The goal of M0:** stand up an empty but _real_ desktop app — an Electron window
> running a React + TypeScript UI, with the full build pipeline and the
> three-process structure (main / preload / renderer) in place. **No terminals
> yet.** This is the skeleton every later milestone hangs off. If this opens a
> window, the foundation is sound.

Pairs with `../textbook/` chapters `03` (Electron architecture), `05` (preload),
`08` (React), `14` (build tooling). Read those for the _general_ theory; this file
explains _our specific files_.

---

## 1. What we added (the file tree)

```
shepherd/
├── package.json              ← scripts + dependencies
├── electron.vite.config.ts   ← how the 3 bundles are built
├── tsconfig.json             ← references the two below
├── tsconfig.node.json        ← TypeScript rules for main + preload
├── tsconfig.web.json         ← TypeScript rules for the renderer
├── eslint.config.mjs         ← linting (flat config)
├── .prettierrc.json          ← formatting
├── .prettierignore
├── .gitignore
├── LICENSE                   ← MIT
├── README.md
└── src/
    ├── main/
    │   └── index.ts          ← MAIN process (Node backend): opens the window
    ├── preload/
    │   └── index.ts          ← the secure window.api bridge
    └── renderer/
        ├── index.html        ← the web page shell
        └── src/
            ├── main.tsx      ← React entry point
            ├── App.tsx       ← the root component (static shell for now)
            ├── App.css       ← dark theme + layout
            └── env.d.ts      ← types for window.api + Vite
```

The three folders under `src/` are the **three worlds** of an Electron app
(textbook ch 03): `main` = the Node backend, `renderer` = the React frontend,
`preload` = the secure bridge between them.

---

## 2. File-by-file

### `package.json` — the control panel

The important parts:

- **`"main": "./out/main/index.js"`** — Electron's entry point. Note it points to
  `out/`, not `src/` — because electron-vite _compiles_ `src/main/index.ts` into
  `out/main/index.js` first.
- **Scripts:**
  - `dev` → `electron-vite dev` — builds everything and launches the app with hot
    reload. **This is what you run while developing.**
  - `build` → `typecheck` then `electron-vite build` — produces the production
    bundles in `out/` (and fails if types are wrong).
  - `typecheck:node` / `typecheck:web` — run the TypeScript compiler in
    _check-only_ mode against the two tsconfigs (no files emitted).
  - `lint` / `format` — ESLint and Prettier.
- **`dependencies`** (shipped at runtime): `react`, `react-dom`.
- **`devDependencies`** (build-time only): `electron`, `electron-vite`, `vite`,
  `@vitejs/plugin-react`, `typescript`, the `@types/*`, ESLint, Prettier.

> **Why the vite version is pinned to 7:** `electron-vite@5` only supports vite
> ≤ 7, but npm's newest `@vitejs/plugin-react@6` wants vite 8. We pin
> **vite 7 + plugin-react 5** so everything agrees. (This was the one install
> hiccup during M0 — a peer-dependency conflict — now resolved.)

### `electron.vite.config.ts` — the build brain

electron-vite builds **three separate bundles**, and this file configures each:

```ts
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { resolve: { alias: { '@renderer': resolve('src/renderer/src') } }, plugins: [react()] }
})
```

- **`externalizeDepsPlugin()`** on main/preload keeps `node_modules` _out_ of those
  bundles (Node can `require` them at runtime). This matters a lot soon: **node-pty**
  is a native module that must stay external, not bundled (textbook ch 14).
- **`react()`** enables JSX + React Fast Refresh in the renderer.
- **`@renderer` alias** lets us write `import x from '@renderer/...'` instead of long
  relative paths.

### `tsconfig.*` — why _three_ files

The main process and the renderer run in **different environments** (Node vs a
browser), so they need different TypeScript settings:

- **`tsconfig.node.json`** (main + preload): `lib: ES2023`, `types: [node,
electron-vite/node]`. No DOM — there's no `document` in the backend.
- **`tsconfig.web.json`** (renderer): `lib: [ES2023, DOM, DOM.Iterable]`,
  `jsx: react-jsx`, `types: [vite/client]`. Has the DOM, no Node.
- **`tsconfig.json`** just _references_ both so editors and `tsc` pick them up.
- Both enable **`"strict": true`** (plus `noUnusedLocals`/`noUnusedParameters`) —
  the strict TypeScript the roadmap asked for.

### `src/main/index.ts` — the backend that opens the window

This is the heart of M0. Walk through the key lines:

```ts
const mainWindow = new BrowserWindow({
  width: 1100,
  height: 720,
  show: false,
  autoHideMenuBar: true,
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'), // load the bridge
    sandbox: false, // needed so preload can load native modules (node-pty) later
    contextIsolation: true, // keep the renderer sandboxed — the secure default
    nodeIntegration: false // the page can't touch Node directly
  }
})
```

- **`show: false` + `ready-to-show`** → we reveal the window only once it's painted,
  so there's no white flash.
- **`setWindowOpenHandler`** → external links open in your real browser, not a new
  Electron window (security + sanity).
- **The dev-vs-prod load:**
  ```ts
  if (process.env['ELECTRON_RENDERER_URL']) mainWindow.loadURL(...)   // dev server
  else mainWindow.loadFile('../renderer/index.html')                  // built file
  ```
  In `dev`, electron-vite runs a Vite dev server and sets `ELECTRON_RENDERER_URL`;
  in production, we load the bundled HTML from disk.
- **Lifecycle:** `app.whenReady()` opens the first window; `window-all-closed`
  quits (except on macOS, per convention).

### `src/preload/index.ts` — the secure bridge

```ts
const api = { version: '0.0.1' }
contextBridge.exposeInMainWorld('api', api)
export type ShepherdApi = typeof api
```

This exposes a tidy **`window.api`** to the React app. For M0 it only carries a
`version` string — just enough to _prove the bridge works_. In M1 this grows into
`sendInput`, `onPtyData`, etc. The renderer will only ever talk to the backend
through this surface (textbook ch 05).

### `src/renderer/` — the React app

- **`index.html`** — a near-empty page with `<div id="root">` and a module script.
- **`main.tsx`** — mounts `<App/>` into `#root` (standard React 19 entry).
- **`App.tsx`** — a **static** shell: a placeholder sidebar + a work area. Crucially
  it reads `window.api?.version` and displays it — so if you see the version on
  screen, **main → preload → renderer are all connected.**
- **`App.css`** — the dark theme and the `sidebar | workarea` flex layout. Note
  `.workarea { min-width: 0 }` — the flexbox gotcha from `../REFRESHER.md` that lets
  the work area (and future terminals) shrink instead of overflowing.
- **`env.d.ts`** — tells TypeScript the shape of `window.api` so `App.tsx` type-checks.

---

## 3. How the build pipeline works (what `npm run dev` actually does)

```
 npm run dev  →  electron-vite dev
      │
      ├─ bundles src/main/index.ts     → out/main/index.js      (Node)
      ├─ bundles src/preload/index.ts  → out/preload/index.js   (bridge)
      ├─ starts a Vite dev server for  src/renderer/   (with hot reload)
      │     and exposes it as ELECTRON_RENDERER_URL
      └─ launches Electron → main opens a window → loads the dev-server URL
```

Edit a React file → the window updates instantly (hot reload). Edit `main` or
`preload` → electron-vite rebuilds and relaunches the app.

`npm run build` does the same bundling but writes production files to `out/` and
runs a full typecheck first.

---

## 4. How this maps to the textbook

| This file                               | Explained in depth by                             |
| --------------------------------------- | ------------------------------------------------- |
| `src/main/index.ts`                     | `../textbook/03-electron-architecture.md`         |
| `src/preload/index.ts`                  | `../textbook/05-preload-and-context-isolation.md` |
| `src/renderer/**`                       | `../textbook/08-react-in-this-app.md`             |
| `electron.vite.config.ts`, `tsconfig.*` | `../textbook/14-build-tooling-and-vite.md`        |

---

## 5. What's intentionally minimal / deferred

- **`window.api` is just `{ version }`.** Real IPC (send keystrokes, receive
  terminal output) arrives in **M1**.
- **No terminal yet.** The work area is static text; M1 drops in node-pty + xterm.js.
- **No Content-Security-Policy** in `index.html` yet → Electron prints an "Insecure
  CSP" warning to the console in dev. That's expected; we harden it at **M6**.
- **ESLint is minimal** (JS + TS recommended). React-specific lint rules come with
  real components in **M2**.
- **No packaging** (AppImage/.deb) — that's **M6**.

---

## 6. How to run it yourself

```bash
npm install     # if you haven't already
npm run dev     # a 1100×720 dark window opens saying "M0 ✓ — the app shell is alive"
```

You should see the placeholder sidebar on the left, and the work area showing the
`window.api.version` value — proof the whole main/preload/renderer chain is wired.

---

## 🧪 Checkpoint

1. Why are there _three_ folders under `src/`, and which process does each become?
2. `package.json`'s `"main"` points at `out/main/index.js`, not `src/…`. Why?
3. What single thing does `App.tsx` display that proves the preload bridge works?
4. Why must `node_modules` stay _external_ to the main bundle (hint: node-pty, M1)?
5. Which milestone turns the static work area into a real terminal?

---

## Next: M1 — a real terminal

We add **node-pty** (a real shell in the backend) and **xterm.js** (the terminal in
the UI), then wire the keystroke→shell→output loop over IPC. That's the make-or-break
milestone — see `../textbook/06-node-pty.md` and `../textbook/07-xtermjs.md`.
