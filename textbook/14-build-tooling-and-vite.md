# Chapter 14 — Build Tooling & Vite

> **What you'll learn**
>
> - _Why bundlers exist at all_ — how a folder of `.ts`/`.tsx` files and `import` statements becomes something a runtime can actually run
> - What **Vite** is: a lightning-fast dev server with **Hot Module Replacement (HMR)** _plus_ a separate production build (**Rollup** under the hood)
> - The Electron wrinkle: you don't have one program to build, you have **three** (main, preload, renderer) — and why plain Vite only understands one of them
> - What **electron-vite** adds: it runs Vite for the **renderer** _and_ bundles the **main** and **preload** entry points, orchestrating all three at once
> - The `main/ preload/ renderer/` project layout, and how the folders _are_ the process model from Chapter 3 made physical
> - A worked, minimal `electron.vite.config.ts` (three build targets) and the matching `package.json` scripts (`dev`/`build`/`lint`), walked through line by line
> - How the dev loop actually feels: `npm run dev` → instant UI hot-reload for the renderer, automatic rebuild-and-relaunch for main/preload
> - **Path aliases** and how both processes import the shared `shared/types.ts`
> - **The native-module wrinkle** — why `node-pty` must be marked _external_ (not bundled) _and_ rebuilt against Electron's ABI, or it won't load at all
>
> **Prerequisites:** `03-electron-architecture.md`. You need the "one main process (Node), one renderer per window (sandboxed Chromium), preload as the bridge" model cold. This chapter is about how those three pieces get _built_ from your source into something Electron can run — in development and in production.

---

## 14.1 Why bundlers exist at all

Start with the problem, because if you don't feel the problem, the tooling looks like ceremony.

You write Shepherd as a tree of small files: a React component per file, a hook per file, a `shared/types.ts`, a `main/index.ts`, a `main/pty.ts`, and so on. They refer to each other with `import`:

```ts
// renderer/src/components/Sidebar.tsx
import { WorkspaceRow } from './WorkspaceRow'
import type { Workspace } from '@shared/types'
import { clsx } from 'clsx' // a package from node_modules
```

This is lovely to _write_. It is not something a browser or Node can _run as-is_, for three separate reasons:

1. **The syntax isn't executable.** `.tsx` is TypeScript + JSX. No browser understands `type Workspace`, and no browser understands `<Sidebar workspaces={ws} />`. That has to be **compiled** down to plain JavaScript first (types stripped, JSX turned into function calls).

2. **The imports don't resolve on their own.** `import { clsx } from 'clsx'` is a _bare specifier_ — there's no path there. A browser has no idea where `clsx` lives; it can't go rummaging through `node_modules`. Something has to trace every import, find the real file on disk, and rewrite the reference.

3. **Hundreds of files = hundreds of round-trips.** Even if the browser _could_ follow imports, shipping 400 separate `.js` files means 400 network requests to load your app. That's slow. You want a handful of optimized files instead.

A **bundler** is the tool that solves all three at once. Conceptually it does this:

```
   many source files                          few runnable files
   ─────────────────                          ──────────────────
   Sidebar.tsx  ─┐
   WorkspaceRow.tsx │   ┌──────────────┐
   hooks/*.ts    ├──►│   BUNDLER     │──►  index.js   (all your code, compiled,
   types.ts      │   │ compile +     │      + tree-shaken, minified)
   node_modules/*┘   │ resolve +     │     index.css
                     │ combine +     │      assets/…
                     │ optimize      │
                     └──────────────┘
```

It **compiles** (TS/JSX → JS), **resolves** every import into one graph, **combines** that graph into a small number of files, and **optimizes** along the way — dropping unused exports (_tree-shaking_), minifying, and hashing filenames for caching. The output is a bundle a runtime can load directly.

> **🔧 In Shepherd:** if you've ever run `create-react-app`, `next dev`, or even
> just imported a package in a Vite project, you've already used a bundler — you
> just never had to configure one. This chapter pulls the curtain back, because
> Electron forces you to care: you have _three_ different runtimes to feed
> (Node, the preload sandbox, Chromium), and only one of them is a browser.

---

## 14.2 Vite: a dev server _and_ a production build

**Vite** (French for "fast," pronounced _veet_) is the bundler/tooling we use. The single most important thing to understand about Vite is that it has **two completely different personalities** depending on whether you're developing or shipping.

### Personality 1 — the dev server (fast, unbundled, hot)

When you're developing, Vite does _not_ bundle your app up front. That's the trick that makes it feel instant. Instead it:

1. Starts a small local **HTTP server** (typically `http://localhost:5173`).
2. Serves your source files **on demand**, as native ES modules, transforming each one _only when the browser asks for it_. A `.tsx` file gets its types stripped and its JSX compiled the moment it's requested (using **esbuild**, a Go-based transformer that's absurdly fast), then handed straight to the browser.
3. Watches your files and pushes updates over a **WebSocket** — this is **HMR**.

Because it never does a big up-front bundle, `npm run dev` starts in _milliseconds_ even in a large project, and stays fast as the project grows.

**What HMR (Hot Module Replacement) actually means.** When you save a file, Vite figures out exactly which module changed and pushes _just that module_ to the running page over the WebSocket. The page patches itself **in place** — it does _not_ do a full reload. Paired with React's _Fast Refresh_, editing a component swaps the new version of that component into the live tree **while preserving its state**. You change a color in the sidebar, hit save, and the sidebar updates in a fraction of a second — the terminal you had open, the workspace you'd selected, the text you'd typed all stay exactly as they were.

```
   OLD WAY (full reload)            HMR (Vite + React Fast Refresh)
   ──────────────────────           ────────────────────────────────
   save file                        save file
     → whole page reloads             → Vite pushes ONE module over WS
     → app boots from scratch         → React swaps that component in place
     → all UI state lost              → state preserved, no reload
     → ~1–3 s                         → tens of milliseconds
```

### Personality 2 — the production build (bundled, optimized)

When you're ready to ship, `vite build` does the "real" bundling from §14.1. Here Vite hands the job to **Rollup** — a mature, highly-optimizing bundler — to walk the entire import graph, tree-shake, minify, hash filenames, and emit a small set of static files (`index.html`, a couple of `.js` chunks, a `.css` file, hashed assets). No dev server, no WebSocket — just files on disk that any static host (or, for us, Electron's `loadFile`) can serve.

So Vite is really _two tools wearing one CLI_: **esbuild-powered dev server for speed** and **Rollup-powered build for output quality**. Keep that split in your head; several gotchas later come straight from the fact that dev and prod are genuinely different machinery.

> **⚠️ Gotcha:** "It worked in `npm run dev` but broke in the built app" is the
> single most common Vite surprise, and it's _because_ dev and build are
> different engines with different assumptions (unbundled ESM over HTTP vs. a
> Rollup bundle loaded from disk). §14.11 lists the specific traps. The habit to
> build now: **before trusting a change, run the production build at least once**,
> don't only test in dev.

---

## 14.3 The Electron wrinkle: you have _three_ programs to build

Everything above assumes a normal web app: one target, the browser. Electron breaks that assumption hard. Recall the process model from `03-electron-architecture.md`:

- **main** — plain **Node.js**. Imports `node-pty`, `net`, `fs`. No DOM, no `window`. Runs in a Node runtime.
- **preload** — a _special_ script that runs in the renderer process **before** your page, in a restricted context, and is the only place allowed to bridge the two worlds. It has its own peculiar constraints (Chapter 5).
- **renderer** — **Chromium + React**. Has `document` and `window`, no Node. Runs in a browser.

These are **three different runtimes with three different rulebooks**, and therefore **three different build targets**:

```
   TARGET      RUNTIME            CAN IMPORT…                  OUTPUT FORMAT
   ────────    ───────────────    ──────────────────────────  ─────────────
   main        Node.js            fs, net, node-pty, path      Node module (CJS/ESM)
   preload     renderer sandbox   a tiny, restricted surface   often CommonJS (see below)
   renderer    Chromium (browser) DOM, React, xterm.js         browser ESM + HTML + CSS
```

Plain Vite only knows how to build **one** of these — the renderer (it's a web tool; the browser is its whole world). It has no concept of "also compile this Node entry point with Node semantics" or "also produce a preload script." If you tried to build main with vanilla Vite, it would try to bundle `node-pty` as if it were browser code and fall on its face.

You need something that understands all three targets and coordinates them. That something is **electron-vite**.

---

## 14.4 electron-vite: one tool, three builds

**electron-vite** is a thin, purpose-built wrapper around Vite for exactly this situation. In one sentence:

> electron-vite runs **Vite** (dev server + HMR) for the **renderer**, and uses Vite/Rollup to bundle the **main** and **preload** entry points with the correct Node-side settings — all driven from a single config file and a single command.

Concretely, it gives you:

1. **One config, three sections.** A single `electron.vite.config.ts` with three keys — `main`, `preload`, `renderer` — each of which is a normal Vite config, but pre-tuned for its target (e.g., the main build already knows it's targeting Node and shouldn't try to bundle native modules).

2. **A dev command that orchestrates everything.** `electron-vite dev` starts the renderer's Vite dev server, bundles main and preload, launches Electron pointed at the dev server, and then _watches_ — hot-reloading the renderer and rebuilding-plus-relaunching on main/preload changes (§14.8).

3. **The dev-URL handoff.** In dev, electron-vite sets the environment variable **`ELECTRON_RENDERER_URL`** to the dev server's address. Remember this fork from Chapter 3's `createWindow`?

   ```ts
   if (process.env.ELECTRON_RENDERER_URL) {
     win.loadURL(process.env.ELECTRON_RENDERER_URL) // dev: the Vite server (HMR!)
   } else {
     win.loadFile(path.join(__dirname, '../renderer/index.html')) // prod: built file
   }
   ```

   **electron-vite is the thing that sets that variable.** That single `if` is the seam between your two Vite personalities: in dev the window loads the live HMR server; in the packaged app the variable is unset, so main loads the Rollup-built `index.html` off disk.

4. **Sensible Electron defaults**, most importantly the **native-module externalization** we'll spend §14.10 on, and a renderer `base` of `./` so built assets resolve correctly from `file://` (§14.11).

Here's the whole tool on one page:

```
                         electron.vite.config.ts
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
   main: { … }               preload: { … }             renderer: { … }
   (Node target)             (bridge target)            (browser target)
        │                          │                          │
   Rollup bundle             Rollup bundle              DEV:  Vite dev server
   → out/main/index.js       → out/preload/index.js           http://localhost:5173 + HMR
                                                        BUILD: Rollup bundle
                                                              → out/renderer/*
```

> **🔧 In Shepherd:** this is why the M0 scaffold in the roadmap is "run the
> electron-vite React+TS template." That template hands you the `main/ preload/
renderer/` split, a working `electron.vite.config.ts`, and a `dev`/`build`
> script pair — the entire skeleton of this chapter, pre-assembled. Everything
> here is explaining what that template already set up for you.

---

## 14.5 The project structure: `main/ preload/ renderer/`

Because there are three build targets, the source tree has three homes. The electron-vite convention looks like this:

```
shepherd/
├─ src/
│  ├─ main/                 ← the BACKEND (Node). Entry: main/index.ts
│  │   ├─ index.ts          ·   app lifecycle, BrowserWindow, IPC handlers
│  │   ├─ pty.ts            ·   node-pty spawning (Ch. 6)
│  │   └─ socket-server.ts  ·   the unix socket API (Ch. 11)
│  │
│  ├─ preload/              ← the BRIDGE. Entry: preload/index.ts
│  │   └─ index.ts          ·   contextBridge.exposeInMainWorld('api', …) (Ch. 5)
│  │
│  └─ renderer/             ← the FRONTEND (Chromium + React)
│      ├─ index.html        ·   the HTML entry Vite serves/builds
│      └─ src/
│          ├─ main.tsx      ·   ReactDOM.createRoot(...)
│          ├─ App.tsx
│          └─ components/…  ·   Sidebar, Pane, Terminal, … (Ch. 8, 10)
│
├─ shared/                  ← code used by MORE THAN ONE target
│   └─ types.ts             ·   Workspace, Pane, Surface, Panel … (Ch. 9)
│
├─ electron.vite.config.ts  ← the three-target build config (§14.6)
├─ package.json             ← scripts + the crucial deps/devDeps split (§14.7)
└─ tsconfig.json            ← TypeScript settings (often one per target)
```

The mapping to Chapter 3 is exact — **the folders are the process model made physical**:

| Folder          | Runs in…                             | Its rulebook                | Chapter                                         |
| --------------- | ------------------------------------ | --------------------------- | ----------------------------------------------- |
| `src/main/`     | the one Node **main process**        | full OS access; no DOM      | `03-electron-architecture.md`, `06-node-pty.md` |
| `src/preload/`  | the **renderer's sandbox**, pre-page | restricted; the only bridge | `05-preload-and-context-isolation.md`           |
| `src/renderer/` | **Chromium** (one per window)        | browser only; no Node       | `08-react-in-this-app.md`, `07-xtermjs.md`      |
| `shared/`       | _compiled into whoever imports it_   | must be runtime-agnostic    | `09-typescript-and-the-data-model.md`           |

That last row matters and is easy to get wrong: **`shared/` must contain only code that's safe in _any_ target.** In practice that means **types and pure functions** — no `import fs`, no `import { Terminal } from 'xterm'`. A type annotation like `interface Workspace { … }` compiles away to nothing, so it's safe to import from both the Node main process and the browser renderer. A helper that imports `fs` is _not_, because it would poison the renderer bundle. Keep `shared/` clean and it's the safest folder in the repo; sneak a Node import in and you've created a cross-target landmine.

> **⚠️ Gotcha:** the exact folder names/paths (`src/renderer/src`, output in `out/…`)
> come from the electron-vite scaffold and can vary between templates/versions.
> Don't memorize the strings — memorize the **shape**: three build targets, one
> shared folder, one config that names them. When a path alias or a `loadFile`
> path looks wrong, check where _your_ scaffold actually put things.

---

## 14.6 A worked `electron.vite.config.ts`

Here is a minimal-but-real config with all three targets. Read the comments; the walkthrough follows.

```ts
// electron.vite.config.ts  — lives at the PROJECT ROOT
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // ── Build #1: the MAIN process (targets Node) ───────────────────────
  main: {
    // Keep node-pty (and every other runtime dependency) OUT of the bundle.
    // This is the native-module fix — see §14.10. It's the single most
    // important line in the whole file.
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('shared') } // so main can `import … from '@shared/types'`
    }
  },

  // ── Build #2: the PRELOAD script (targets the renderer sandbox) ──────
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('shared') }
    }
  },

  // ── Build #3: the RENDERER (targets Chromium/the browser) ───────────
  renderer: {
    plugins: [react()], // JSX + React Fast Refresh (HMR)
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'), // clean imports inside the UI
        '@shared': resolve('shared') // the SAME shared types, in the browser
      }
    }
    // electron-vite already defaults `base` to './' here so built assets
    // resolve correctly under file:// in the packaged app (§14.11).
  }
})
```

Walking through it:

- **`defineConfig({...})`** is electron-vite's own helper (not plain Vite's). It expects an object with up to three keys — `main`, `preload`, `renderer` — and each key's value is an ordinary Vite config object. This one function call is what declares "there are three builds here."

- **`main` and `preload` each get `externalizeDepsPlugin()`.** This plugin's entire job: for these Node-side targets, treat everything listed under `dependencies` in `package.json` as **external** — i.e., _don't_ bundle it; leave the `require('node-pty')` in place to be resolved from `node_modules` at runtime. This is the key that makes native modules work (§14.10) and also keeps the Node builds small and fast. You put it on both main and preload because both run outside the browser.

- **`renderer` gets `react()`** — the `@vitejs/plugin-react` plugin. This is what compiles JSX and, crucially, wires up **React Fast Refresh** so the HMR from §14.2 preserves component state. Notice the renderer does _not_ get `externalizeDepsPlugin` — the renderer is a browser bundle and _wants_ everything (React, xterm.js, your components) bundled together into files the window can load.

- **`resolve.alias`** appears in all three. `@shared → shared/` lets any target write `import type { Workspace } from '@shared/types'` instead of brittle `../../../shared/types` chains. The renderer additionally aliases `@renderer` for tidy intra-UI imports. Aliases are just Vite/Rollup rewriting the specifier to a real path at build time — nothing magic, but they matter enough to get their own section (§14.9).

Notice what's _symmetrical_ and what's _not_. All three share the `@shared` alias (they all consume the shared types). Only main/preload externalize deps (they run in Node). Only the renderer gets React (only it renders a UI). Each block is tuned to its runtime's rulebook from §14.3.

---

## 14.7 The matching `package.json`

The config declares _how_ to build; `package.json` declares _what to run_ and — critically for native modules — _which dependencies are bundled vs. kept external_.

```jsonc
{
  "name": "shepherd",
  "version": "0.1.0",

  // Electron runs THIS file first. Note: it points at the BUILT main output,
  // not your source. `electron-vite dev` builds it before launching.
  "main": "./out/main/index.js",

  "scripts": {
    "dev": "electron-vite dev", // §14.8 — the hot dev loop
    "build": "electron-vite build", // produce out/{main,preload,renderer}
    "typecheck": "tsc --noEmit -p tsconfig.json", // types: checked separately (see below)
    "lint": "eslint . --ext .ts,.tsx"
  },

  // dependencies = shipped as real files in node_modules AT RUNTIME.
  // node-pty is NATIVE, so it MUST live here and be externalized (§14.10).
  "dependencies": {
    "node-pty": "^1.0.0"
  },

  // devDependencies = only needed at BUILD time; they get bundled into your
  // output (renderer) or aren't needed once built. Nothing here is external.
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-vite": "^2.0.0",
    "vite": "^5.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "typescript": "^5.5.0",
    "eslint": "^9.0.0"
  }
}
```

The three scripts, in plain English:

- **`dev`** → `electron-vite dev`. Boots the whole hot-reloading development app. This is what you run 99% of the time. Full breakdown next section.
- **`build`** → `electron-vite build`. Runs all three production builds and writes them to `out/`. This does _not_ package an installer — that's `15-packaging-and-distribution.md`'s job. `build` just turns your source into optimized `out/{main,preload,renderer}` files.
- **`lint`** → ESLint over the whole tree. Standard hygiene; nothing Electron-specific.

Two things worth pausing on:

**Why `"main": "./out/main/index.js"` and not `src/main/index.ts`?** Because Electron is a Node runtime — it can't execute TypeScript directly. The `main` field must point at the _built_ JavaScript. In dev, electron-vite compiles `src/main/index.ts → out/main/index.js` before it launches Electron, so by the time Electron reads this field, the file exists. In the packaged app, that same built file is what ships. This is the concrete reason main is a _build target_ and not just "run the .ts file."

**Why a separate `typecheck` script?** This trips up people coming from `ts-node`. For speed, Vite/esbuild **strip types without checking them** — esbuild transpiles each file in isolation and _does not_ do full type-checking (it can't; type errors often span files). So a red squiggle in your editor will happily build and run. You catch real type errors by running `tsc --noEmit` separately (in CI, or via this script). Bundling and type-checking are **two different jobs**; Vite does the first, `tsc` does the second.

> **🔧 In Shepherd:** the `dependencies` vs `devDependencies` split is not
> bookkeeping here — it's _load-bearing_. `externalizeDepsPlugin()` externalizes
> exactly what's in `dependencies`. Put `node-pty` there and it stays a real,
> loadable native module. Accidentally put it in `devDependencies` and electron-vite
> will try to _bundle_ it, which fails (you can't inline a compiled `.node`
> binary). Rule of thumb: **native/runtime-required packages → `dependencies`;
> everything that's compiled into your JS → `devDependencies`.**

---

## 14.8 The dev experience, end to end

Now the payoff — what actually happens when you run `npm run dev`, and why the loop feels the way it does. This is the single most important workflow in the whole project, so let's trace it carefully.

```
$ npm run dev            (= electron-vite dev)
       │
       ├─ 1. start a Vite DEV SERVER for the renderer  → http://localhost:5173  (HMR ready)
       ├─ 2. bundle src/main/    → out/main/index.js
       ├─ 3. bundle src/preload/ → out/preload/index.js
       ├─ 4. set  ELECTRON_RENDERER_URL = http://localhost:5173
       └─ 5. launch Electron (which runs out/main/index.js)
                    │
                    └─ main creates a BrowserWindow and, because the env var is set,
                       calls  win.loadURL(process.env.ELECTRON_RENDERER_URL)
                                    │
                                    ▼
                       the window loads your React app FROM the live Vite server
```

Now the app is running. What happens when you edit a file depends on **which target** the file belongs to — and this is the key mental split:

```
  You edit a RENDERER file            You edit a MAIN or PRELOAD file
  (a .tsx component, some CSS)         (spawning logic, an IPC handler)
        │                                    │
  Vite pushes just that module          electron-vite re-bundles that target…
  over the HMR WebSocket                      │
        │                              …then RESTARTS the Electron app
  React Fast Refresh swaps it          (a fresh Node process — it has to,
  in place — NO reload, state kept      because Node code is already running)
        │                                    │
  ⚡ tens of milliseconds,             🔁 a second or two; the window blinks
     terminal/scroll/selection kept       and the app relaunches from scratch
```

Why the asymmetry? Because the two sides live at different layers:

- The **renderer** is a web page. A running web page can accept a hot-swapped module without restarting — that's what HMR _is_. So renderer edits are near-instant and **non-destructive**: your open terminal, selected workspace, and scroll position all survive. This is where you'll spend most of your day, and it's a joy.

- **main** and **preload** are not web pages; they're a Node process (and a script that initializes with the page). You can't hot-patch a function into an already-running Node process that has open sockets and spawned shells and expect sanity. So electron-vite does the safe thing: rebuild the target and **relaunch the Electron app**. That's why a one-line change in `main/index.ts` blinks the whole window and resets state, while a one-line change in `Sidebar.tsx` doesn't.

> **⚠️ Gotcha:** a relaunch means your **spawned shells die and re-spawn** and your
> in-memory state resets. That's expected for main/preload edits. It's also a
> nudge toward good architecture: the more your UI state lives in the renderer
> (which survives HMR) and the more your durable state is _persisted_ (Ch. 13),
> the less a main-process reload hurts. If every tiny backend tweak wipes work you
> care about, that's a hint the state belongs somewhere more durable.

> **🔧 In Shepherd:** this asymmetry shapes how you'll actually build. Iterating
> on the sidebar's look, the tiling layout, xterm theming? Pure renderer work —
> HMR makes it feel like editing a live web page. Iterating on `node-pty` spawn
> flags or a socket-API method? That's main — expect the rebuild-and-relaunch
> rhythm, and lean on session persistence (Ch. 13) so a relaunch restores your
> workspaces instead of starting from a blank slate.

---

## 14.9 Path aliases and the shared `shared/types.ts`

Let's zoom in on one line from the config, because it's how the whole app stays type-safe across the process boundary.

The data model (`09-typescript-and-the-data-model.md`) defines the core shapes once — `Workspace`, `Pane`, `Surface`, `Panel`, and the IPC message types — in `shared/types.ts`. **Both sides need them.** The main process constructs a `Workspace` and sends it over IPC; the renderer receives it and renders it. If each side had its _own_ copy of the type, they'd drift and you'd get runtime shape mismatches that TypeScript couldn't catch. One shared definition, imported by both, means the compiler enforces that the sender and receiver agree.

Without aliases, importing that file from deep in the tree is ugly and fragile:

```ts
// renderer/src/components/sidebar/WorkspaceRow.tsx
import type { Workspace } from '../../../../shared/types' // 😖 count the dots… and re-count if you move the file
```

The `resolve.alias` entry `'@shared': resolve('shared')` lets every target instead write:

```ts
import type { Workspace } from '@shared/types' // 🙂 same line from main, preload, OR renderer
```

An **alias** is just a rewrite rule: at build time, Vite/Rollup sees `@shared/...` and substitutes the real absolute path to the `shared/` folder. It's not a runtime feature and it's not TypeScript-specific — it's the bundler resolving the specifier for you. Because we declared the _same_ alias in all three config blocks (§14.6), the identical import line works from any process. `shared/types.ts` becomes the **single source of truth** for the shapes that cross the IPC wire.

> **⚠️ Gotcha:** an alias in `electron.vite.config.ts` teaches the _bundler_ where
> `@shared` points — but your **editor and `tsc` don't read that file.** You must
> mirror the alias in `tsconfig.json`'s `compilerOptions.paths` too, or you'll get
> the maddening state where the app _builds and runs fine_ but your editor
> underlines every `@shared` import in red and `npm run typecheck` fails. Two
> places, kept in sync: the Vite alias (for bundling) and the tsconfig path (for
> type resolution). Forgetting the second is a rite of passage.

---

## 14.10 The native-module wrinkle: `node-pty`

This is the section that separates "an Electron build" from "a plain web build," and it's exactly where a full-stack dev new to Electron gets stuck. Take it slowly.

### What makes `node-pty` special

`node-pty` (`06-node-pty.md`) is not pure JavaScript. It's a **native module**: part of it is C++ compiled into a platform-specific binary — a `.node` file (e.g. `node_modules/node-pty/build/Release/pty.node`). That binary is what actually talks to the OS to allocate a pseudo-terminal. When you `require('node-pty')`, its JS wrapper loads that compiled `.node` file.

Two facts about that binary drive everything in this section:

```
   require('node-pty')
        │
        ▼
   node-pty/index.js  ──loads──►  build/Release/pty.node   ← a COMPILED C++ BINARY
                                        │
        ┌───────────────────────────────┴──────────────────────────────┐
   FACT 1: you cannot bundle a binary            FACT 2: it's compiled against ONE
   into a JavaScript string. A bundler           specific engine's ABI. Load it in a
   inlines .js/.ts text; it has no way to         runtime with a different ABI and it
   swallow a .node executable.                    refuses to load — hard error.
```

### Fact 1 → mark it **external** (don't bundle it)

Because you can't inline a `.node` binary into a JS bundle, `node-pty` must be treated as **external**: the build leaves `require('node-pty')` untouched, and at runtime Node resolves it from `node_modules` the normal way. That's precisely what **`externalizeDepsPlugin()`** does for the `main` and `preload` builds (§14.6) — it externalizes everything in `dependencies`, which is why `node-pty` _must_ be a `dependency` (§14.7). Bundle it and the build breaks; externalize it and it loads at runtime like any Node module.

This is also why `node-pty` lives only in **main**. The renderer is a browser bundle with no `node_modules` at runtime and no ability to load a `.node` file — so it can never import `node-pty` (see §14.11). Only the Node-side targets can.

### Fact 2 → rebuild it against **Electron's ABI**

This is the subtle one. **ABI** (Application Binary Interface) is the low-level contract between a compiled binary and the engine that loads it. Node exposes this as `process.versions.modules` — a number like `115` or `125` that identifies the ABI version. A `.node` file compiled against ABI 115 will **only** load into a runtime that speaks ABI 115.

Here's the trap: **Electron ships its _own_ build of Node/V8**, and its ABI number is usually _different_ from the system Node you used to `npm install`. So the sequence "install node-pty (compiled for system Node) → run it inside Electron (different ABI)" produces this classic, panic-inducing error:

```
Error: The module '/…/node_modules/node-pty/build/Release/pty.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 115. This version of Node.js requires
NODE_MODULE_VERSION 125. Please try re-compiling or re-installing
the module (for instance, using `npm rebuild` or `npm install`).
```

Read it in plain English: _"this binary was built for a different engine than the one now trying to load it."_ The fix is to **recompile `node-pty` against Electron's ABI**, using one of:

- **`@electron/rebuild`** (formerly `electron-rebuild`) — a tool that detects your Electron version and rebuilds every native module against _its_ ABI. Run it after `npm install` (a `postinstall` script is common): `npx electron-rebuild`.
- **electron-builder's rebuild step** — if you package with electron-builder (`15-packaging-and-distribution.md`), it runs `install-app-deps`, which rebuilds native deps against the target Electron automatically as part of packaging.

```
   npm install                 npx electron-rebuild            run in Electron
   ───────────                 ────────────────────            ───────────────
   node-pty compiled for  ──►  recompiled against       ──►    loads cleanly ✅
   SYSTEM node (ABI 125)       ELECTRON's ABI (e.g. 115)       (ABIs now match)
```

> **⚠️ Gotcha:** this ABI mismatch bites again every time you **upgrade Electron**
> (its ABI may jump) or switch machines/CI (different system Node). The symptom is
> always that `NODE_MODULE_VERSION` error, and the fix is always "rebuild native
> modules for the current Electron." Wire `electron-rebuild` into a `postinstall`
> script early and it becomes invisible; discover it during a release crunch and
> it's an afternoon of confusion. It is _the_ rite-of-passage bug of shipping an
> Electron app with a native dependency — and node-pty is that dependency for us.

> **🔧 In Shepherd:** `node-pty` is our _only_ native module, but it's a
> load-bearing one — no `node-pty`, no real shells, no app. So this whole section
> collapses to three rules you must keep true: (1) `node-pty` is a **`dependency`**,
> (2) `externalizeDepsPlugin()` is on **main** and **preload**, (3) a **rebuild
> step** runs after install and after any Electron upgrade. Get those three right
> and native modules are a non-event; get one wrong and the app won't start.

---

## 14.11 Gotchas roundup: three ways dev and prod differ

Most Electron build pain is one process trying to do another's job, or dev quietly hiding a problem that prod exposes. The big three:

### 1. The renderer cannot import Node built-ins

`import fs from 'node:fs'`, `import net from 'node:net'`, or `import { spawn } from 'node:child_process'` **in renderer code** is a category error. The renderer is a browser bundle — those modules don't exist there. Depending on config you'll get a build-time resolve error or a runtime `X is not defined` — and occasionally something _worse_: a bundler that "helpfully" injects a broken browser shim, so it _looks_ fine in dev and detonates in the built app.

The rule is the same wall from Chapter 3, now enforced at build time: **Node built-ins belong in `main`/`preload`.** If the renderer needs something OS-level (read a file, spawn a shell, hit the socket), it doesn't import a Node module — it calls a function you exposed on `window.api`, and the main process does the privileged work (`04-ipc-inter-process-communication.md`, `05-preload-and-context-isolation.md`). If you _ever_ find yourself wanting `fs` in a component, that's the signal to add an IPC handler instead.

### 2. Native-module ABI mismatch

Covered in depth in §14.10 — flagged again here because it's _the_ build gotcha. Symptom: `NODE_MODULE_VERSION` error on launch. Cause: `node-pty` compiled for a different engine than Electron. Fix: rebuild against Electron's ABI. Triggers: fresh install, new machine/CI, Electron upgrade.

### 3. Asset and path differences between dev and prod

In **dev**, the renderer is served by Vite over **`http://localhost:5173`** — there's a server, a URL origin, and an absolute path like `/assets/logo.png` resolves against that origin. In **prod**, the renderer is static files loaded via **`file://`** (`win.loadFile(...)`) — there is _no server and no origin_, so an absolute `/assets/...` path points at your filesystem root and 404s. This is why the built app can show a blank window or missing images while dev looked perfect.

The fix is to make the renderer use **relative** asset paths — Vite's `base` option, which **electron-vite already defaults to `./` for the renderer** precisely for this reason (§14.6). The practical discipline: **let Vite/the bundler handle assets** (`import logoUrl from './logo.png'` and use `logoUrl`) rather than hand-writing absolute string paths, and — per §14.2 — **actually run and open the production build** before trusting a release. Same idea bites the _main_-side paths: in dev `__dirname` and the dev URL are in play; in prod you're doing `loadFile(path.join(__dirname, '../renderer/index.html'))` against the `out/` layout. When "works in dev, blank in build" strikes, path resolution is the first suspect.

```
   DEV                                   PROD (packaged)
   ───                                   ───────────────
   renderer via  http://localhost:5173   renderer via  file:///…/out/renderer/index.html
   ELECTRON_RENDERER_URL set             ELECTRON_RENDERER_URL unset → loadFile
   /assets/x.png resolves via server     /assets/x.png → filesystem root → 404
   HMR WebSocket live                    no server, no HMR — just static files
```

---

## 🧪 Checkpoint

Answer these before moving on (everything's in this chapter):

1. Give the three distinct jobs a bundler does when it turns your folder of `.tsx` files into runnable output. Why can't a browser just run your source directly?
2. Vite has "two personalities." Name them, say which bundler powers the production one, and explain in one sentence what HMR does that a full page reload doesn't.
3. A plain web app has one build target; Shepherd has three. Name them, and say which runtime each targets. Why can't vanilla Vite build all three?
4. In one sentence each: what does electron-vite run for the **renderer**, and what does it do for **main** and **preload**? Which environment variable does it set in dev, and which `if` in `createWindow` (Chapter 3) consumes it?
5. You edit `Sidebar.tsx` and your open terminal keeps its scrollback; you edit `main/index.ts` and the whole app blinks and relaunches. Explain _why_ the two behave differently.
6. Why must `node-pty` be listed in `dependencies` (not `devDependencies`), and what does `externalizeDepsPlugin()` do with it? What would break if you bundled it instead?
7. What is an "ABI," why does a native module compiled for your system Node fail to load inside Electron, and what tool fixes it? Name one other moment (besides first install) that re-triggers this bug.
8. A teammate's built app shows a blank window though `npm run dev` works perfectly. Give two plausible causes from §14.11 and how you'd confirm each.

---

## Summary

A **bundler** exists to turn a tree of `.ts`/`.tsx` files and `import` statements into a small set of optimized files a runtime can load — compiling away TS/JSX, resolving every import into one graph, and combining and minifying the result. **Vite** is our bundler, and it has two personalities: an **esbuild-powered dev server** with **HMR** (instant, state-preserving updates over a WebSocket) and a **Rollup-powered production build** (bundled, minified static files). But Electron isn't one program — it's **three build targets** (Node **main**, the **preload** bridge, Chromium **renderer**), each with its own rulebook, and plain Vite understands only the browser one. **electron-vite** fills the gap: it runs Vite (with HMR) for the renderer and bundles main and preload with Node-appropriate settings, all from a single `electron.vite.config.ts` with `main`/`preload`/`renderer` sections, and it sets **`ELECTRON_RENDERER_URL`** in dev so the window loads the live server (and falls back to `loadFile` in prod). The source tree mirrors the process model — `main/`, `preload/`, `renderer/`, plus a `shared/` folder of runtime-agnostic types imported everywhere via a `@shared` **path alias**. `npm run dev` boots the whole thing; **renderer edits hot-reload in place while main/preload edits rebuild-and-relaunch**. The defining Electron complication is the **native module** `node-pty`: it can't be bundled (so it's kept **external** via `externalizeDepsPlugin`, which is why it's a `dependency`) and it must be **rebuilt against Electron's ABI** (via `electron-rebuild` or the packager's rebuild step) or it throws `NODE_MODULE_VERSION`. The recurring theme — and the source of every "works in dev, breaks in build" bug — is that **dev and prod are genuinely different machinery**, so the renderer can't import Node built-ins and asset paths must stay relative.

## Where this shows up next

- The `loadURL`-vs-`loadFile` fork this chapter feeds, and the process model the folders mirror → `03-electron-architecture.md`
- Why only main may `require('node-pty')`, and the shells the rebuild step keeps alive → `06-node-pty.md`
- The `window.api` bridge the renderer calls _instead of_ importing Node → `05-preload-and-context-isolation.md` and `04-ipc-inter-process-communication.md`
- The `shared/types.ts` shapes the `@shared` alias resolves → `09-typescript-and-the-data-model.md`
- Turning the `out/` build into an installable AppImage/.deb — where the native-module rebuild happens again at packaging time → `15-packaging-and-distribution.md`
- Why a main-process relaunch is survivable — persisting and restoring your workspaces → `13-session-persistence.md`
- The end-to-end trace that runs on top of everything built here → `17-how-it-all-connects.md`

## Further reading

- Vite — "Why Vite" (the dev-server-vs-build split, native ESM, esbuild): https://vitejs.dev/guide/why.html
- Vite — Features & HMR API: https://vitejs.dev/guide/features.html
- electron-vite — official docs (config, the three targets, `externalizeDepsPlugin`): https://electron-vite.org/
- Rollup — the bundler behind Vite's production build: https://rollupjs.org/
- `@electron/rebuild` — rebuilding native modules against Electron's ABI: https://github.com/electron/rebuild
- Node.js — C++ addons & `NODE_MODULE_VERSION`/ABI background: https://nodejs.org/api/addons.html
- esbuild — the fast transformer powering Vite's dev server: https://esbuild.github.io/
