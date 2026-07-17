# Chapter 16 — Glossary

> **How to use this:** This is a quick-reference for every term the book uses —
> alphabetized, each defined in plain English and tied back to cmux-linux where it
> helps. Skim it anytime; when you want the full story, follow the
> `(see NN-...md)` pointer to the chapter that covers the term in depth.
> Cross-reference stubs (e.g. *TTY — see teletype*) just send you to the primary
> entry.

---

## A

- **ABI (Application Binary Interface)** — The binary contract between compiled code and its host (Node's C++ internals, the OS). A native module like node-pty is compiled against one specific ABI, so it must be rebuilt or ship a prebuilt binary matching the exact Node/Electron version — a mismatch throws the classic "compiled against a different Node.js version" error. (see 06-node-pty.md)
- **addon (xterm.js)** — An optional plug-in that extends the base xterm.js terminal: FitAddon (sizing), WebGL addon (GPU drawing), SearchAddon (find). You load only the ones you need. (see 07-xtermjs.md)
- **agent activity** — Optional detail that refines a `working` semantic state,
  such as reading, editing, testing, or web search. Activity improves display but
  is not a stable automation state. (see 19-semantic-agent-runtime.md)
- **agent block reason** — Optional detail that explains a `blocked` state, such
  as approval, user input, authentication, tool error, or an external dependency.
  It determines whether the workspace needs attention. (see 19-semantic-agent-runtime.md)
- **agent record** — The renderer's current normalized description of one live
  agent: identity, provider, source, semantic state, timestamps, and its verified
  workspace/pane/surface ownership. (see 19-semantic-agent-runtime.md)
- **agent semantic state** — The small provider-neutral lifecycle vocabulary
  `working`, `blocked`, `done`, `idle`, and `unknown`. Scripts depend on this
  layer; the UI may refine it with activity or block reason. (see 19-semantic-agent-runtime.md)
- **ANSI escape code** — A short byte sequence starting with the ESC character (`0x1B`) that a program embeds in its output to *control* the terminal — move the cursor, set colors, clear the screen — instead of printing literal text. Named after the ANSI X3.64 standard. (see 02-how-terminals-work.md)
- **AppImage** — A single self-contained executable that bundles the app and its dependencies and runs on most Linux distros with no install step. Our primary distribution format. (see 15-packaging-and-distribution.md)
- **attention state** — see *unread / attention state*.

## B

- **BrowserWindow** — Electron's class for creating an OS window; you configure its size and options, and its `webContents` loads your UI. Each BrowserWindow drives one renderer process. (see 03-electron-architecture.md)
- **byte stream** — A continuous, unstructured flow of bytes with no built-in message boundaries — what moves between a shell and its terminal, and through a socket. Bytes arrive as they come (sometimes splitting a sequence mid-way), so you must buffer and parse them yourself. (see 02-how-terminals-work.md)

## C

- **canonical vs raw mode** — Two modes of the terminal line discipline. In *canonical* ("cooked") mode the kernel buffers a whole line and handles editing (backspace) before your program sees it; in *raw* mode every keystroke is delivered instantly with no processing — which is what shells and full-screen apps (and our terminals) need. (see 02-how-terminals-work.md)
- **Chromium** — The open-source browser engine behind Google Chrome. Electron embeds it to run the renderer process, so your UI is literally a web page with full HTML/CSS/JS — our React app — running inside it. (see 03-electron-architecture.md)
- **cmux** — The macOS-only "terminal built for multitasking" we are recreating on Linux: a named-workspace sidebar, per-workspace agent-status lines, notification rings, split panes, and a socket API. We copy its *experience*, not its Swift code. (see 01-the-big-picture.md)
- **cmux CLI** — The small `cmux` command agents and scripts run (e.g. `cmux notify ...`). It's a thin client that opens the unix socket, sends one JSON-RPC line, and prints the reply. (see 11-the-socket-api.md)
- **contextBridge** — The Electron API used inside a preload script to safely expose a chosen set of functions onto the renderer's `window` (as `window.api`), without leaking Node.js or Electron internals into the web page. (see 05-preload-and-context-isolation.md)
- **contextIsolation** — An Electron security setting (on by default) that runs the preload script and the web page in separate JavaScript contexts, so the page can't reach into Node/Electron. The only crossing is what contextBridge explicitly exposes. (see 05-preload-and-context-isolation.md)
- **CSI (Control Sequence Introducer) sequence** — The most common family of ANSI escape codes, those beginning `ESC [`, used for cursor movement, colors (SGR), and screen clearing — e.g. `ESC[31m` sets red text. (see 02-how-terminals-work.md)

## D

- **`.deb`** — The Debian/Ubuntu package format; a `.deb` installs the app system-wide via `apt`/`dpkg`. One of our distribution targets. (see 15-packaging-and-distribution.md)
- **debounce** — A timing technique that delays running a function until a burst of rapid triggers stops (e.g. run only 300 ms after the last change). We use it so session state is written once after edits settle rather than on every keystroke. (see 13-session-persistence.md)
- **desktop notification** — A native OS pop-up (via Electron's Notification API) we raise when an agent needs attention, on top of the in-app ring/flash. (see 12-notifications-and-osc.md)
- **discriminated union** — A TypeScript pattern where several object shapes share a common literal "tag" field (e.g. `kind: 'leaf' | 'split'`) so the compiler can narrow to the right shape once you check the tag. Our `PaneNode` layout tree is one. (see 09-typescript-and-the-data-model.md)

## E

- **Electron** — A framework for building desktop apps with web tech; it bundles Chromium (for the UI) and Node.js (for OS access) into one app. cmux-linux *is* an Electron app. (see 03-electron-architecture.md)
- **electron-builder** — The tool that packages our built app into installable artifacts (AppImage, `.deb`, Flatpak), handling icons, metadata, and native-module bundling. (see 15-packaging-and-distribution.md)
- **electron-vite** — A thin integration of Vite tailored for Electron; it understands the three build targets (main, preload, renderer) and bundles each correctly, with HMR in dev. (see 14-build-tooling-and-vite.md)
- **env injection** — Passing custom environment variables into a child process when you spawn it. We inject `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`, and `CMUX_SOCKET_PATH` into each terminal's shell via node-pty so commands run inside a pane know which workspace to talk to. (see 06-node-pty.md)
- **escape sequence / escape code** — see *ANSI escape code* (and *CSI sequence*, *OSC*).

## F

- **FitAddon** — An xterm.js addon that measures the container element and resizes the terminal's grid (cols × rows) to fit, so we can then tell node-pty the new size. (see 07-xtermjs.md)
- **Flatpak** — A sandboxed Linux packaging/distribution system (apps come from Flathub) with bundled runtimes. An optional distribution target for us. (see 15-packaging-and-distribution.md)

## G

- **Ghostty** — A fast, GPU-accelerated terminal emulator (written in Zig); cmux is built on its engine. We can't easily reuse it from Electron, so we approximate it with xterm.js + the WebGL addon. (see 07-xtermjs.md)

## H

- **HMR (Hot Module Replacement)** — A dev-server feature (Vite's) that swaps an edited module into the running app without a full reload, preserving state — so UI changes appear near-instantly while you code. (see 14-build-tooling-and-vite.md)
- **hook (agent lifecycle hook)** — A configured command an agent runs at a
  lifecycle event such as a tool call, permission request, turn completion, or
  session end. `cmux integrations setup` installs hooks that translate these
  events into semantic reports. (see 19-semantic-agent-runtime.md)

## I

- **IPC (Inter-Process Communication)** — Any mechanism for separate processes to exchange data. In Electron it's the message channel between main and renderer; treat it exactly like frontend↔backend API calls. (see 04-ipc-inter-process-communication.md)
- **ipcMain / ipcRenderer** — Electron's two IPC endpoints. `ipcRenderer` (in the renderer) sends, invokes, and listens; `ipcMain` (in main) handles those requests and can push messages back. (see 04-ipc-inter-process-communication.md)

## J

- **JSON-RPC** — A simple convention for remote calls where each request is a JSON object like `{ id, method, params }` and each reply is `{ id, result }` or `{ id, error }`. Our socket API uses this shape. (see 11-the-socket-api.md)

## L

- **layout tree (PaneNode)** — The recursive tree describing a workspace's splits: each node is either a *leaf* (one pane) or a *split* (a direction, child nodes, and sizes). Rendering it produces the tiled layout. (see 10-tiling-and-layout.md)
- **libghostty** — The C library extracted from the Ghostty terminal that powers cmux's GPU renderer. We deliberately *don't* use it — its C/Zig API is unstable and awkward to bind from Electron — and use xterm.js (+ WebGL addon) instead. (see 07-xtermjs.md)
- **line discipline** — The kernel layer sitting between a pty and the program on it that processes bytes — echoing typed characters, handling backspace and Ctrl-C, and switching between canonical and raw mode. (see 02-how-terminals-work.md)

## M

- **main process** — Electron's single Node.js process — the app's entry point and "backend." It has full OS access, spawns the shells, runs the socket server, and creates windows. (see 03-electron-architecture.md)
- **Map (pty registry)** — A JavaScript `Map` we keep in the main process from `ptyId` → the live node-pty process, so incoming IPC (e.g. "write to pane X") can find the right shell. It's just our lookup table of open terminals. (see 06-node-pty.md)
- **master / slave** — see *primary / subordinate*.
- **message framing** — The rule for where one message ends and the next begins in a byte stream. Our socket uses newline-delimited JSON: one message per line, so the receiver splits on `\n`. (see 11-the-socket-api.md)

## N

- **native module** — A Node module written in C/C++ (compiled to a `.node` binary) rather than pure JS, used when you need OS-level features. node-pty is one, which is why packaging must ship the correct prebuilt binary. (see 06-node-pty.md)
- **node-pty** — The native Node library that spawns a real shell inside a pseudo-terminal and gives us `write()`, an `onData` stream, `resize()`, and `kill()`. It's the "backend" half of every terminal. (see 06-node-pty.md)

## O

- **OSC (Operating System Command)** — A family of escape sequences beginning `ESC ]` used to talk to the terminal/OS itself — set the window title, define hyperlinks, or fire desktop notifications — rather than draw on the screen. (see 02-how-terminals-work.md; the notification codes: 12-notifications-and-osc.md)
- **OSC 9 / 99 / 777** — Specific OSC sequences a program emits to request a desktop notification. We scan each terminal's output for them and, when one appears, light up the sidebar automatically — no setup required. (see 12-notifications-and-osc.md)

## P

- **Pane** — In our object model, a resizable split region inside a workspace (⌘D / Ctrl-D splits it). Panes are the rectangles you tile. (see 09-typescript-and-the-data-model.md; how they tile: 10-tiling-and-layout.md)
- **Panel** — The actual content rendered in a surface — a Terminal (v1) or, later, a Browser. It's the leaf of the object model. (see 09-typescript-and-the-data-model.md)
- **preload script** — A special script Electron runs in the renderer *before* the web page loads, with access to a limited bridge API. It's where we use contextBridge to build `window.api`. (see 05-preload-and-context-isolation.md)
- **primary / subordinate (master / slave)** — The two ends of a pty pair. The controlling program (our app, via node-pty) holds the *primary* end; the shell runs attached to the *subordinate* end, which looks like a real terminal to it. (Older docs call these master/slave.) (see 02-how-terminals-work.md)
- **pseudo-terminal (PTY)** — A software emulation of a physical terminal: a kernel-provided pair of endpoints that lets one program feed input to, and read output from, another program (a shell) as if a human were sitting at a terminal. (see 02-how-terminals-work.md; the library that spawns them: 06-node-pty.md)
- **PTY** — see *pseudo-terminal*.

## R

- **raw mode** — see *canonical vs raw mode*.
- **ref (useRef)** — A React hook that holds a mutable value across renders without triggering a re-render. We use it to hold the imperative xterm.js `Terminal` instance and the DOM node it mounts into. (see 08-react-in-this-app.md)
- **renderer process** — An Electron process running a Chromium window — our React UI. It has no direct OS access; it asks main to do OS things over IPC. Think "the frontend." (see 03-electron-architecture.md)
- **revision (agent report)** — An optional monotonic producer sequence number.
  The reducer rejects a sequenced report that is not newer than the stored
  revision, preventing stale lifecycle state from overwriting newer state.
  (see 19-semantic-agent-runtime.md)

## S

- **sandbox** — A security restriction that limits what the renderer's web content can do (no direct filesystem or Node access), so a compromised page can't reach the OS. It works alongside contextIsolation. (see 05-preload-and-context-isolation.md)
- **scrollback** — The buffer of past output lines xterm.js keeps above the visible area so you can scroll up. Its size is configurable. (see 07-xtermjs.md)
- **serialization** — Turning in-memory objects into a storable/transmittable form (usually JSON) and back. We serialize the Window/Workspace tree to disk to persist sessions. (see 13-session-persistence.md)
- **shell** — The program (bash, zsh, fish) that reads your commands, runs them, and prints results — the thing actually running inside each terminal. node-pty spawns one per terminal. (see 02-how-terminals-work.md)
- **signal (Unix signal)** — A small asynchronous notification the OS delivers to a process — e.g. `SIGTERM` to ask it to quit, `SIGKILL` to force-kill, `SIGWINCH` on resize. We send signals to control the shells we spawn. (see 06-node-pty.md)
- **SIGWINCH** — The Unix signal ("window change") the kernel sends a program when its terminal's size changes, prompting it to re-query rows/cols and redraw. node-pty's `resize()` triggers it. (see 06-node-pty.md)
- **socket (unix domain socket)** — An inter-process channel that looks like a file path (e.g. `/tmp/cmux-linux.sock`) instead of a network address — fast, local-only IPC. Our socket API server listens on one; the `cmux` CLI connects to it. (see 11-the-socket-api.md)
- **status pill** — A small colored label in a workspace's sidebar row (e.g. a green "build passing"), set via the socket `set-status` method. (see 12-notifications-and-osc.md)
- **stdin / stdout / stderr** — The three standard streams every process has: input (fd 0), normal output (fd 1), and error output (fd 2). A shell reads keystrokes from stdin and writes results to stdout/stderr, which flow back to the terminal. (see 02-how-terminals-work.md)
- **structured clone** — The algorithm Electron (and browsers) use to deep-copy a JS value when sending it across a boundary like IPC. It handles objects, arrays, Maps, and more — but not functions or class instances — so IPC payloads must be plain data. (see 04-ipc-inter-process-communication.md)
- **Surface** — In our object model, a tab within a pane; each pane has its own tab bar, and each surface owns exactly one panel. (see 09-typescript-and-the-data-model.md)

## T

- **Tauri** — An alternative to Electron that pairs a Rust backend with the OS's *native* webview (no bundled Chromium), yielding smaller apps. We chose Electron for its mature Node ecosystem (node-pty) and one consistent Chromium everywhere. (see 03-electron-architecture.md)
- **teletype (TTY)** — The original electromechanical terminal (a printing keyboard); its abbreviation survives as "TTY," the kernel's word for a terminal device. A pty is a software stand-in for one. (see 02-how-terminals-work.md)
- **tiling** — Automatically arranging panes to fill the available space without overlapping (as opposed to floating windows). Splitting a pane subdivides its rectangle; our layout tree drives the arrangement. (see 10-tiling-and-layout.md)
- **TTL (time to live)** — A bounded lifetime attached to an agent report. Main
  converts it to a local expiry time so a missing provider cleanup event cannot
  leave the sidebar stale forever. (see 19-semantic-agent-runtime.md)
- **TTY** — see *teletype*.
- **TypeScript** — JavaScript plus a static type system checked at build time. We use it to model the Window→Workspace→Pane→Surface→Panel data and catch shape errors before they run. (see 09-typescript-and-the-data-model.md)

## U

- **unread / attention state** — Two per-workspace booleans that drive the sidebar's alerts: `attention` rings/flashes a workspace that needs you now; `unread` keeps a badge until you look. Both are set by OSC parsing or a `cmux notify`. (see 12-notifications-and-osc.md)

## V

- **Vite** — A fast, modern build tool and dev server (native ES modules + esbuild/Rollup). electron-vite wraps it to bundle our main, preload, and renderer code and provide HMR. (see 14-build-tooling-and-vite.md)
- **VT100** — A hugely influential 1978 DEC video terminal whose escape-code set became the de-facto standard that terminal emulators (and xterm.js) still implement today. (see 02-how-terminals-work.md)

## W

- **webContents** — The Electron object representing a window's rendered web page. Its `.send(channel, payload)` is how main pushes IPC messages to the renderer. (see 04-ipc-inter-process-communication.md; it's a property of BrowserWindow, 03-electron-architecture.md)
- **WebGL addon** — An xterm.js addon that renders the terminal on the GPU (via WebGL) for smooth, fast drawing of lots of text — our pragmatic stand-in for cmux's GPU (Ghostty) renderer. (see 07-xtermjs.md)
- **Window** — In our object model, an OS window with its own sidebar and independent set of workspaces. (Distinct from Electron's BrowserWindow, which *implements* it.) (see 09-typescript-and-the-data-model.md)
- **window.api** — The object our preload script exposes (via contextBridge) onto the renderer's global `window`, bundling the safe functions the React UI calls to reach main — e.g. `window.api.sendInput(...)`. (see 05-preload-and-context-isolation.md)
- **Workspace** — In our object model, one row in the sidebar: a named context (a project or agent) with its own layout, cwd, git branch, status, and notification state. (see 09-typescript-and-the-data-model.md)

## X

- **xterm.js** — The front-end library that draws a terminal in the DOM: it paints text, colors, and the cursor, and turns keystrokes into bytes — but runs no shell itself. The "picture" half of every terminal. (see 07-xtermjs.md)

## Z

- **zombie process** — A child process that has exited but whose entry lingers in the process table because the parent never collected its exit status ("reaped" it). Properly killing and awaiting node-pty processes keeps us from leaking them. (see 06-node-pty.md)

---

## Where this shows up next

You now have the vocabulary. The finale, `17-how-it-all-connects.md`, spends every
one of these terms at once: it traces a single keystroke — and a single agent
notification — end-to-end through xterm.js, the preload bridge, IPC, node-pty, the
socket API, and the OSC parser, so you can watch the whole machine turn as one.
Read it last; this glossary is the key that unlocks it.
