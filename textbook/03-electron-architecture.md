# Chapter 3 — Electron's Architecture: Two Processes in a Trench Coat

> **What you'll learn**
> - What Electron actually *is* under the hood (a web browser and a Node.js runtime, married in one app)
> - The multi-process model: the one **main** process, one-or-more **renderer** processes, and the helper processes you'll rarely touch
> - Exactly which responsibilities live in main vs renderer — and why cmux-linux splits them the way it does
> - How to create a window with `BrowserWindow`, and what each critical `webPreferences` flag does
> - The `app` lifecycle (`whenReady`, `window-all-closed`, `activate`, `before-quit`) and where macOS and Linux disagree
> - *Why* the two processes are walled off from each other (security + stability), and the gotchas that trips up every Electron newcomer
>
> **Prerequisites:** `01-the-big-picture.md`. You should already have the "main = backend, renderer = frontend, IPC = the API between them" mental model from Chapter 1. This chapter zooms all the way into the left-and-right boxes of that architecture diagram.

---

## 3.1 What Electron actually is

You already know how to ship a web app: a **React frontend** running in a browser, talking to a **Node/Express backend** running on a server, over HTTP. Two programs, two runtimes, one network wire between them.

Electron takes that exact shape and **collapses it onto a single desktop machine.** It does this by bundling two things you already know into one downloadable app:

1. **Chromium** — the open-source guts of Google Chrome. This is a *real* web browser engine: it parses HTML, runs your React, executes JavaScript via the V8 engine, and paints pixels. When your Electron app shows a window, that window *is* a Chromium browser tab wearing a native title bar.
2. **Node.js** — the same Node you run on a server. Full access to the filesystem, the network, child processes, native modules. This is the "backend," except it's running on the user's laptop instead of in a datacenter.

So an Electron app is, quite literally:

```
     Electron  =  Chromium (a browser)  +  Node.js (a server runtime)
                  ───────────────────      ────────────────────────
                  runs your React UI       runs your OS-level code
                  "the frontend"           "the backend"
```

That's the whole trick. Instead of `fetch()`-ing across the internet to a backend you deployed, your frontend talks to a Node backend running *in the same app, on the same machine*, over a local message channel called **IPC** (Chapter 4). Everything you know about the frontend/backend split still applies — you've just swapped "HTTP over the network" for "IPC over a local pipe."

> **🔧 In cmux-linux:** this is *why* the stack is such a good fit for you. The
> renderer is plain React + TypeScript + CSS (the sidebar, tabs, tiled panes).
> The main process is plain Node (spawning shells with node-pty, running a unix
> socket server, saving sessions to disk). There's no exotic new language — it's
> React on the front, Node on the back, exactly like the web apps you've built,
> just packaged as one installable Linux app.

### Who actually ships Electron apps?

If this feels like a toy, it isn't. A huge share of the desktop software on your machine right now is Electron:

- **Visual Studio Code** — the editor a large fraction of the industry uses daily.
- **Slack**, **Discord**, **Microsoft Teams** — chat apps you probably have open.
- **Figma's** desktop app, **Notion**, **Obsidian**, **1Password**, **Postman**, the **GitHub Desktop** client, and many more.

The reason they all reach for it is the same reason we do: **you write the UI once, with web technologies your team already knows, and get a cross-platform desktop app** (Windows, macOS, Linux) almost for free. cmux itself is a native macOS app built in Swift/AppKit — beautiful, but locked to one OS and one language. By choosing Electron we trade a little RAM and binary size for the ability to *actually ship on Linux* using React and Node. That's the whole bet (see the decisions log in `ROADMAP.md`).

---

## 3.2 The multi-process model

Here's the first genuinely new idea, and it's the spine of this entire chapter: **an Electron app is not one process. It's several.** Chromium is a multi-process architecture, and Electron inherits it wholesale.

You can think of it as one boss and a team of specialists:

```
                    ┌──────────────────────────────────────────┐
                    │            MAIN PROCESS  (exactly 1)        │
                    │        Node.js runtime — full OS access     │
                    │                                             │
                    │   • app lifecycle    • creates BrowserWindows│
                    │   • node-pty shells  • unix socket server    │
                    │   • filesystem       • session persistence   │
                    │            = "the backend / the boss"        │
                    └───────┬───────────────────────┬─────────────┘
                            │ creates & owns          │ auto-managed
              ┌─────────────┴────────┐      ┌─────────┴──────────────┐
              ▼                      ▼      ▼                        ▼
   ┌────────────────────┐  ┌────────────────┐   ┌────────────────────────┐
   │  RENDERER  #1        │  │  RENDERER  #2   │   │  GPU + UTILITY processes │
   │  Chromium + React    │  │  (2nd window)   │   │  (compositing, network, │
   │  sandboxed, NO Node  │  │  own React app  │   │   audio, etc.)          │
   │  = "the frontend"    │  │                 │   │  you rarely touch these │
   └────────────────────┘  └────────────────┘   └────────────────────────┘
```

Let's name each kind of process.

### The main process (there is exactly one)

The **main process** is the entry point of your app — it's the file Electron runs first (`main` in `package.json`). It is a **plain Node.js process with no browser, no DOM, no `window` object.** It has the full power of Node: it can read and write files, open network sockets, spawn other programs, load native C++ modules.

Its defining jobs:
- **Own the application's lifecycle** — start up, decide when to quit.
- **Create and manage windows** — every window on screen is a `BrowserWindow` the main process created.
- **Do anything that needs the operating system** — because it's the *only* process allowed to.

There is **one and only one** main process for the whole app. It's the boss. If it dies, the app dies.

### The renderer processes (one per window)

Each window you open runs in its own **renderer process.** A renderer *is a Chromium browser tab* — it loads an HTML page, runs your React app, has a `window` and a `document`, and paints the UI. It's the "frontend."

The critical, non-negotiable fact: **a renderer is sandboxed. It has NO direct access to Node.js or the operating system.** Inside a renderer, `require('fs')` fails. You can't open a socket, read a file, or spawn a shell. It can only do what a normal web page can do — plus call the specific, safe functions you deliberately expose to it through the preload bridge (Chapters 4 and 5).

If you open two windows, you have **two independent renderer processes** — two separate React apps, two separate memory spaces, two separate JavaScript heaps. They don't share variables. If one window's page crashes or hits an infinite loop, the others (and the main process) keep running. That isolation is a feature, not an accident — more on why in §3.8.

### The helper processes (GPU, utility) — good to know, rarely touched

Chromium also spins up a few background helpers that Electron manages for you:

- A **GPU process** handles hardware-accelerated drawing and compositing. When you enable xterm.js's WebGL renderer for smooth terminal scrolling (a Chapter 7 / M6 concern), this is the process doing that GPU work.
- **Utility processes** handle things like networking, audio, and out-of-process work Chromium prefers to isolate.

You will almost never write code that touches these directly. Just know they exist so that when you see five `cmux-linux` entries in your system monitor, you understand *why*: one main, one-or-more renderers, plus GPU/utility helpers. That's normal and healthy, not a leak.

> **⚠️ Gotcha:** "one process" is the single most common wrong mental model for
> Electron. People write code assuming their `BrowserWindow`'s React can just
> `require('node-pty')` and spawn a shell inline. It cannot — that code runs in a
> sandboxed renderer. Shell-spawning lives in **main**; the renderer *asks* main
> to do it over IPC. Burn this in now and Chapters 4–6 will feel obvious.

---

## 3.3 What the main process is responsible for

Let's get concrete about the boss's job description, because in cmux-linux the main process does a *lot* of the interesting work.

| Responsibility | What it means | Chapter |
|---|---|---|
| **App lifecycle** | Boot the app, create the first window, decide when to quit, clean up on exit | this chapter (§3.6) |
| **Window management** | Create/close `BrowserWindow`s, set their size and options, load the UI into them | this chapter (§3.5) |
| **Native OS APIs** | Menus, dialogs, tray icons, and crucially **desktop notifications** (the notification when an agent needs you) | `12-notifications-and-osc.md` |
| **Spawning real shells** | Every terminal you see is a real `bash`/`zsh` spawned here with **node-pty** | `06-node-pty.md` |
| **The socket API server** | A `net` unix-socket server on `/tmp/cmux-linux.sock` that agents push status into | `11-the-socket-api.md` |
| **Watching pty output** | Scanning shell output for OSC 9/99/777 escape codes to auto-fire notifications | `12-notifications-and-osc.md` |
| **Session persistence** | Serializing your workspaces/panes/cwds to JSON and restoring them on next launch | `13-session-persistence.md` |

Notice the pattern: **anything that touches the operating system lives in main.** Files, sockets, child processes, native notifications — all main. This isn't a style choice; it's the *only* place that code can physically run, because the renderer is sandboxed away from all of it.

> **🔧 In cmux-linux:** re-read the three "core loops" from Chapter 1 with this
> lens. In Loop A (you type), main is the end of the line — it calls
> `ptyProcess.write()`. In Loop B (shell prints), main is the *source* — `pty.onData`
> fires in main and gets pushed out. In Loop C (an agent notifies), main is where
> the socket server receives the message, updates state, and fires the OS
> notification. The main process is the gravitational center of the whole app.

---

## 3.4 What the renderer process is responsible for

The renderer's job is comparatively narrow, and it's the part you already know cold:

- **Render the UI.** The entire visual app — the workspace sidebar, the tab bars, the tiled split panes, the terminals — is a React component tree living here (`08-react-in-this-app.md`).
- **Hold the UI's state.** Which workspace is active, which pane has focus, the layout tree of splits — that's React state and refs in the renderer (`09-typescript-and-the-data-model.md`, `10-tiling-and-layout.md`).
- **Paint the terminals.** xterm.js is a browser library; it draws into DOM/canvas/WebGL, so it *must* run in the renderer (`07-xtermjs.md`). But remember from Chapter 1: xterm.js is a **puppet**. It paints the bytes it's handed; it does not run a shell.
- **Capture user input.** Keystrokes, clicks, resize events — the renderer catches them and forwards the relevant ones to main over IPC.

And here's the wall, stated plainly:

> The renderer **cannot** read a file, open a socket, spawn a process, or import a
> Node module. It can only render, hold state, and **ask main to do OS things** via
> the functions exposed on `window.api` (Chapter 5).

If you've ever built a React app that talks to a backend API, this is a familiar discipline. Your React components never open a database connection directly — they call your API, and the server does the privileged work. Same here: the renderer calls `window.api.sendInput(...)`, and main does the privileged `pty.write(...)`. The preload bridge is the "API client"; IPC is the "network."

> **⚠️ Gotcha:** `require('fs')` (or `import fs from 'node:fs'`) inside a React
> component will throw at runtime — `fs is not defined` or `require is not a
> function`. That's not a bug to fix by "enabling node in the renderer." It's the
> sandbox working as designed. The fix is always: move the file access to main and
> expose a narrow function for it. If you ever find a tutorial telling you to set
> `nodeIntegration: true` to make `require` work in the renderer, close the tab —
> that's the old, insecure way (see §3.8).

---

## 3.5 Creating a window: `BrowserWindow` and `webPreferences`

To put anything on screen, the main process creates a `BrowserWindow`. Think of it as `new Tab()` — you get a Chromium window, and you tell it what URL or HTML file to load. Here is a minimal, realistic main process for cmux-linux, annotated line by line:

```ts
// main/index.ts — the entry point of the whole app (runs in the MAIN process)
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,                     // don't flash an empty window; show when ready
    backgroundColor: '#0d1117',      // dark bg so there's no white flash on load
    webPreferences: {
      // The preload script: the ONLY code that bridges renderer ↔ main. Ch. 5.
      preload: path.join(__dirname, '../preload/index.js'),

      // Keep the renderer sandboxed from Node. These three are the security core:
      contextIsolation: true,        // renderer's JS world ≠ preload's JS world
      nodeIntegration: false,        // no require()/process in the renderer
      sandbox: true,                 // OS-level sandbox around the renderer
    },
  });

  // Show only once the page has painted — avoids an ugly blank frame.
  win.once('ready-to-show', () => win.show());

  // Load the UI. In dev, Vite serves it over HTTP with hot-reload.
  // In production, we load the built static file from disk.
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);          // e.g. http://localhost:5173
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}
```

Walking through it in plain English:

- **`new BrowserWindow({...})`** creates the OS window and its dedicated renderer process. `width`/`height`/`backgroundColor` are cosmetic. `show: false` plus the `ready-to-show` handler is a standard trick to avoid a white flash — you keep the window hidden until Chromium has actually painted the first frame.
- **`webPreferences`** is the security- and capability-critical block. The three flags below are the ones that matter most for us.
- **`loadURL` vs `loadFile`** is the dev-vs-production fork. During development, `electron-vite` runs a Vite dev server (with hot module reloading) and hands you its URL via an env var; you point the window at that URL so your React edits appear instantly. In a packaged app there's no dev server — the renderer is a built `index.html` + JS bundle on disk, so you `loadFile` it. (Chapter 14 covers how this bundling works; Chapter 15 covers packaging.)

### The three `webPreferences` flags you must understand

These three lines are doing more work than anything else in the file:

- **`preload`** — the path to your *preload script*. This is a special file that runs in the renderer process **but before your web page loads**, and it's the sole place allowed to bridge the two worlds. It's how `window.api` gets created. This is important enough to get its own chapter — `05-preload-and-context-isolation.md`.
- **`contextIsolation: true`** — keeps the preload's JavaScript world separate from your React app's JavaScript world, so the page can't reach in and tamper with the bridge. It's `true` by default in modern Electron; you keep it that way. (Full explanation in Chapter 5.)
- **`nodeIntegration: false`** — the renderer does **not** get `require`, `process`, `Buffer`, or any Node globals. This is why `require('fs')` fails in a component. Also the default; also non-negotiable for us.

Together these three enforce the wall from §3.4. The renderer stays a sandboxed web page, and the *only* door between it and Node's power is the narrow, deliberate set of functions your preload chooses to expose. We'll add `sandbox: true` on top for an extra OS-level cage around the renderer.

> **🔧 In cmux-linux:** these are exactly the settings our M0/M1 scaffold uses. When
> you generate the app with `electron-vite`'s React+TS template, you get a `main/`,
> `preload/`, and `renderer/` folder split precisely because of this architecture:
> `main/` is Node code, `renderer/` is your React app, and `preload/` is the thin
> bridge that `webPreferences.preload` points at. The folder layout *is* the process
> model made physical.

---

## 3.6 The `app` lifecycle

The other half of the main process's job is orchestrating the app itself: booting up, reacting to windows closing, and shutting down cleanly. This is the `app` object — Electron's global application controller. You wire behavior to its lifecycle **events**. Here are the four that matter, continuing our example:

```ts
// Still in main/index.ts

// 1. whenReady(): Electron has finished initializing. Only NOW may you make windows.
app.whenReady().then(() => {
  createWindow();

  // 3. activate: macOS re-opens a window when the dock icon is clicked and
  //    no windows are open. (Harmless to include on Linux; it just won't fire.)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 2. window-all-closed: every window is closed. On Linux/Windows, quit the app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {   // 'darwin' === macOS
    app.quit();
  }
});

// 4. before-quit: last chance to clean up before the process dies.
app.on('before-quit', () => {
  killAllPtyProcesses();   // don't leave zombie bash processes behind (Ch. 6)
  closeSocketServer();     // release /tmp/cmux-linux.sock (Ch. 11)
});
```

Let's take these one at a time, because the ordering and the platform quirks matter.

- **`app.whenReady()`** — a promise that resolves once Electron has fully booted its internals. **You must not create a `BrowserWindow` before this resolves.** Trying to open a window too early is a classic first-day crash. Everything window-related hangs off `whenReady`.

- **`window-all-closed`** — fires when the user closes the last window. On **Linux and Windows**, the convention is: no windows means the app is done, so you `app.quit()`. On **macOS**, the convention is the *opposite* — apps traditionally keep running (in the menu bar) even with no windows open, so you deliberately *don't* quit. That's the `process.platform !== 'darwin'` guard.

- **`activate`** — a macOS-ism. On macOS, clicking a still-running app's dock icon should re-open a window. This event lets you recreate one if none exist. On Linux it essentially never fires, so including it is harmless; it just makes the same codebase behave correctly if you ever build a Mac version too (which Electron makes nearly free).

- **`before-quit`** — your cleanup hook, fired just before the app tears down. This is where you **kill every shell you spawned** so you don't orphan `bash` processes, and where you **close the socket server** so the `/tmp/cmux-linux.sock` file is released. Skipping this is how you end up with zombie processes and a stale socket that blocks the next launch.

> **⚠️ Gotcha (macOS vs Linux):** the `!== 'darwin'` and `activate` dance looks like
> boilerplate you can delete since we're targeting Linux — and on Linux it mostly
> is inert. Keep it anyway. It costs nothing, it's the idiomatic Electron pattern
> every example uses, and it means the day you cross-compile a Mac build (a real
> possibility — see `ROADMAP.md` stretch goals) the app already behaves like a
> proper Mac citizen. Writing platform-correct lifecycle code from day one is
> cheaper than retrofitting it.

### The lifecycle as a timeline

```
   app starts
      │
      ▼
   app.whenReady()  ──►  createWindow()  ──►  renderer boots, loads React UI
      │                                              │
      │                                    user works in the app...
      │                                              │
      ▼                                              ▼
   user closes last window  ──►  'window-all-closed'  ──►  (Linux) app.quit()
                                                              │
                                                              ▼
                                                        'before-quit'
                                                              │
                                          kill ptys + close socket, then exit
```

---

## 3.7 Why isolate the processes at all?

We keep asserting "the renderer can't touch Node, and that's good." Let's justify it properly, because understanding the *why* keeps you from fighting the framework. There are two independent reasons: **security** and **stability**.

### Security: your UI renders untrusted content

Think about what actually flows through a terminal. It renders the output of arbitrary programs — `npm install` pulling packages you didn't write, an AI agent running commands, a `git log` showing commit messages from strangers, a `curl` dumping a web response. Terminal output is *untrusted data*. So is anything a web page might load.

Now imagine the renderer had full Node access, and some malicious string in that output managed to execute (through a rendering bug, an escape-sequence exploit, or a compromised dependency). With Node access, that code could read your SSH keys, exfiltrate files, or spawn processes — **game over.** By sandboxing the renderer and forcing all OS access through a tiny, explicit set of preload functions, you shrink the attack surface from "all of Node" to "the handful of operations we deliberately allowed, each of which validates its input." A terminal keystroke handler that only ever calls `pty.write()` on a known pane can't be tricked into reading `~/.ssh/id_rsa`. That's the payoff. Chapter 5 makes this concrete and Electron's own [security checklist](https://www.electronjs.org/docs/latest/tutorial/security) is built around exactly this principle.

### Stability: one crashing tab shouldn't kill everything

The other reason is the same reason your web browser uses separate processes per tab: **fault isolation.** If your React app in one window hits an infinite loop, corrupts its heap, or crashes outright, that failure is contained to *that renderer process*. The main process survives. Other windows survive. Electron can even detect the dead renderer and reload it. If everything ran in one process, one bad component would take down the entire app, including every unsaved terminal session in every other window. Multi-process design turns catastrophic crashes into recoverable, local ones.

> **🔧 In cmux-linux:** this stability guarantee is why "each `BrowserWindow` is its
> own renderer" matters practically. If you eventually support multiple app windows
> (each with its own workspace sidebar, per the object model in Chapter 1), a
> runaway render in one window won't freeze the terminals humming along in another.
> The shells themselves are even safer — they live in *main*, entirely outside any
> renderer, so a renderer crash never kills your running `bash`. Main can just spawn
> a fresh renderer and re-attach the still-alive pty to it.

---

## 3.8 The mental model to carry forward

Compress this chapter into a few sentences you can recall instantly:

1. **Electron = Chromium (a browser) + Node.js (a server), bundled as one desktop app.** VS Code, Slack, and Discord are all built this way.
2. **There is exactly one main process (Node, full OS access) and one renderer per window (sandboxed Chromium running your React).** Plus GPU/utility helpers you can ignore.
3. **Main does everything OS-level:** windows, shells (node-pty), the socket server, notifications, persistence. **The renderer only renders and holds UI state.**
4. **`BrowserWindow` + `webPreferences` (preload, `contextIsolation: true`, `nodeIntegration: false`) is where the wall gets built.**
5. **The wall exists for security (a terminal renders untrusted output) and stability (one crashed window can't sink the app).**

If those five click, you're ready for the obvious next question: *if the two processes can't call each other directly, how do they actually communicate?* That's IPC, and it's the entire next chapter.

---

## 🧪 Checkpoint

Answer these before moving on (everything's in this chapter):

1. In one sentence each, what two well-known programs is an Electron app made by "marrying," and which one runs your React?
2. How many main processes does an app have? How many renderer processes? What determines the renderer count?
3. A teammate writes `import fs from 'node:fs'` inside a React component and it throws at runtime. Explain *why* it throws and where that file-reading code actually belongs.
4. What do `contextIsolation: true` and `nodeIntegration: false` each do, and why do we keep both on?
5. On Linux, why do we guard `app.quit()` with `process.platform !== 'darwin'` in the `window-all-closed` handler? What would break on macOS if we didn't?
6. Give the two independent reasons the renderer is walled off from Node, and tie each to something specific about cmux-linux (hint: terminals render untrusted output; multiple windows).
7. Where does the `before-quit` event fit in the lifecycle, and name two things cmux-linux must clean up there.

---

## Summary

An Electron app is **two programs in a trench coat**: a single **main process** (a full Node.js runtime with OS access) and one **renderer process per window** (a sandboxed Chromium tab running your React app), plus GPU/utility helpers you rarely touch. The main process owns the app lifecycle, creates windows via `BrowserWindow`, and does everything OS-level — in cmux-linux that's spawning shells with node-pty, running the unix socket server, firing desktop notifications, and persisting sessions. The renderer only renders the UI and holds its state; it **cannot** touch Node directly, by design. That wall is built in `webPreferences` with `preload`, `contextIsolation: true`, and `nodeIntegration: false`, and it exists for two reasons: **security** (terminals render untrusted output, so the renderer must be sandboxed) and **stability** (a crash in one window can't take down the app). The `app` lifecycle (`whenReady` → create windows, `window-all-closed`/`activate` with their macOS-vs-Linux quirks, `before-quit` for cleanup) is the main process's orchestration layer. The natural next question — how the walled-off processes talk — is IPC.

## Where this shows up next
- How the two isolated processes actually communicate → `04-ipc-inter-process-communication.md`
- The `preload` bridge and `contextIsolation` in full depth → `05-preload-and-context-isolation.md`
- What main *does* with its OS access — spawning real shells → `06-node-pty.md`
- The React app that fills the renderer → `08-react-in-this-app.md`
- The socket server that lives in main → `11-the-socket-api.md`
- Native desktop notifications from main → `12-notifications-and-osc.md`
- Saving/restoring the app on relaunch → `13-session-persistence.md`
- How `main/`, `preload/`, and `renderer/` get bundled (dev URL vs built file) → `14-build-tooling-and-vite.md`
- Turning all this into an installable AppImage/.deb → `15-packaging-and-distribution.md`
- The end-to-end trace that reuses every box here → `17-how-it-all-connects.md`

## Further reading
- Electron — Process Model (the canonical explainer): https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron — `BrowserWindow` API: https://www.electronjs.org/docs/latest/api/browser-window
- Electron — `app` API (lifecycle events): https://www.electronjs.org/docs/latest/api/app
- Electron — Security checklist (why the sandbox matters): https://www.electronjs.org/docs/latest/tutorial/security
- Chromium — Multi-process architecture (where Electron inherits it from): https://www.chromium.org/developers/design-documents/multi-process-architecture/
