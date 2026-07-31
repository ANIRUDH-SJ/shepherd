# Shepherd — Crash Course / Refresher

Quick revision of the stuff you **already know** but want sharper, framed around
how each is actually used in this project. Skim it, run the snippets, move on.
Pair this with `LEARNING.md` (the new Electron stuff) and `ROADMAP.md` (the plan).

---

## 1. React — components, hooks, refs

The whole UI (sidebar, tabs, panes) is React. The only hooks you really lean on
here are **`useState`**, **`useEffect`**, and — critically for terminals —
**`useRef`**.

### Components = functions that return UI

```tsx
function Sidebar({ workspaces, activeId, onSelect }) {
  return (
    <div className="sidebar">
      {workspaces.map((w) => (
        <button
          key={w.id}
          className={w.id === activeId ? 'row active' : 'row'}
          onClick={() => onSelect(w.id)}
        >
          <div className="name">{w.name}</div>
          <div className="status">{w.status}</div>
        </button>
      ))}
    </div>
  )
}
```

Props flow **down**, events flow **up** (via callbacks like `onSelect`). That's the
whole data-flow model.

### `useState` — local reactive data

```tsx
const [activeId, setActiveId] = useState<string | null>(null)
setActiveId('ws-2') // triggers a re-render
```

Rule: **never mutate state directly.** Always call the setter with a new value/object.

### `useEffect` — run side effects, and clean them up

Runs _after_ render. The **dependency array** controls when. The **return function**
is cleanup (runs before re-run and on unmount) — you'll use this to dispose
terminals and remove IPC listeners.

```tsx
useEffect(() => {
  const off = window.api.onPtyData(handleData) // subscribe
  return () => off() // cleanup ← don't forget
}, []) // [] = run once on mount
```

Mental model:

- `[]` → once, on mount
- `[x]` → on mount + whenever `x` changes
- no array → after _every_ render (rarely what you want)

### `useRef` — hold a value/DOM node WITHOUT re-rendering

This is the key hook for xterm.js. xterm is a non-React library that draws into a
raw DOM node, so you give it a div via a ref and keep the Terminal instance in a ref.

```tsx
function TerminalPane({ paneId }) {
  const boxRef = useRef<HTMLDivElement>(null) // the div xterm draws into
  const termRef = useRef<Terminal | null>(null) // the xterm instance (survives renders)

  useEffect(() => {
    const term = new Terminal()
    term.open(boxRef.current!)
    termRef.current = term
    const off = window.api.onPtyData(paneId, (d) => term.write(d))
    term.onData((d) => window.api.sendInput(paneId, d))
    return () => {
      off()
      term.dispose()
    } // cleanup
  }, [paneId])

  return <div className="term" ref={boxRef} />
}
```

**Why a ref, not state?** Changing a ref does **not** re-render. You don't want React
re-rendering 60×/sec as terminal bytes stream — xterm manages its own canvas.

> Revise just these: `useState`, `useEffect` (+ cleanup), `useRef`, props-down/events-up.
> That covers ~95% of this app's React.

---

## 2. Node built-ins — `fs`, `net`, `child_process`

The Electron **main process is just Node**. These three modules do the backend work.

### `fs` (+ `chokidar`) — files & watching

Used in M3/M4 to read/write workspace status files and **watch** the state dir.

```js
import { readFile, writeFile } from 'node:fs/promises'
await writeFile(statusPath, JSON.stringify({ status: 'waiting' }))
const txt = await readFile(statusPath, 'utf8')

// watching (chokidar is nicer/cross-platform than fs.watch)
import chokidar from 'chokidar'
chokidar.watch(stateDir).on('change', (path) => pushStatusToRenderer(path))
```

Prefer the **promise API** (`node:fs/promises`) + `async/await`.

### `net` — the unix-socket automation API (M5)

This is how cmux's "socket API" works. Node makes it trivial:

```js
import net from 'node:net'
const server = net.createServer((sock) => {
  sock.on('data', (buf) => {
    const cmd = JSON.parse(buf.toString()) // { action: "new-tab", ... }
    handle(cmd)
    sock.write(JSON.stringify({ ok: true }))
  })
})
server.listen('/tmp/shepherd.sock')
```

A client (the `shepherd` CLI) just connects to the same path and writes JSON.

### `child_process` — running programs

node-pty handles the _terminals_, but for one-off commands (e.g. `git branch`) you
use this. Prefer `spawn` for streaming, `execFile` for "run and get output".

```js
import { execFile } from 'node:child_process'
execFile('git', ['branch', '--show-current'], (err, stdout) => console.log(stdout.trim()))
```

**`spawn` vs `exec`:** `spawn` streams output (good for long/large output, no shell
by default = safer); `exec`/`execFile` buffer the whole output (good for short).
Avoid `exec` with string interpolation of user input (shell-injection risk) — use
`execFile`/`spawn` with an args array.

---

## 3. npm / package.json / bundlers

You know this — just the bits that matter here.

### package.json anatomy

```jsonc
{
  "main": "out/main/index.js", // Electron's entry (the main process)
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "lint": "eslint ."
  },
  "dependencies": {
    // shipped at runtime (xterm, node-pty)
    "node-pty": "^1.x",
    "@xterm/xterm": "^5.x"
  },
  "devDependencies": {
    // build-time only (electron, vite, typescript)
    "electron": "^3x",
    "electron-vite": "^2.x",
    "typescript": "^5.x"
  }
}
```

- **dependencies vs devDependencies:** runtime vs build-time. node-pty/xterm are
  runtime; electron/vite/ts are dev.
- **`^` vs `~`:** `^1.2.3` allows `1.x.x` (minor+patch), `~1.2.3` allows `1.2.x` (patch only).
- **`package-lock.json`:** pins exact versions — commit it.
- **native modules (node-pty):** compiled C++. If it errors after an Electron
  upgrade, run `electron-rebuild` to recompile it against Electron's Node version.

### Bundler (Vite) in one line

Vite takes your many `.tsx`/`.ts` files + imports and produces a few optimized
bundles the browser/Electron can load, with instant hot-reload in dev.
`electron-vite` just runs Vite for the renderer _and_ bundles the main/preload too.

---

## 4. CSS / flexbox

The cmux layout = **a fixed sidebar + a flexible main area**, then panes tiled
inside. Flexbox does all of it.

### The app shell

```css
.app {
  display: flex;
  height: 100vh;
} /* sidebar | main, full height */
.sidebar {
  width: 260px;
  flex: 0 0 260px; /* fixed width, don't grow/shrink */
  overflow-y: auto;
}
.main {
  flex: 1 1 auto;
  min-width: 0; /* takes the rest; min-width:0 lets it shrink */
  display: flex;
  flex-direction: column;
}
```

The flex shorthand is `flex: <grow> <shrink> <basis>`:

- `flex: 0 0 260px` → fixed 260px (the sidebar)
- `flex: 1 1 auto` → fills remaining space (the main area)

### Splitting a tab into panes

```css
.panes {
  display: flex;
  flex: 1;
} /* horizontal split */
.panes.vertical {
  flex-direction: column;
} /* vertical split */
.pane {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
} /* equal panes */
```

> **Gotcha you'll hit:** a flex child won't shrink below its content unless you set
> `min-width: 0` / `min-height: 0`. Terminals overflow without it — remember this one.

### Sidebar row (matching the screenshot)

```css
.row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  text-align: left;
}
.row.active {
  background: #1f6feb;
  border-radius: 6px;
} /* blue highlight */
.row .name {
  font-weight: 600;
}
.row .status {
  font-size: 12px;
  opacity: 0.6;
} /* dim subtitle */
```

For the notification "ring/flash," a CSS `@keyframes` animation toggled by a class.

> Revise: `display:flex`, the `flex:` shorthand, `flex-direction`, and the
> `min-width:0` shrink gotcha. That's all the layout needs.

---

## 5. Express thinking → Electron IPC (the bridge concept)

You don't write Express here, but your Express instinct **is** the IPC model — this
is the fastest way to "get" Electron.

| Express (what you know)              | Electron IPC (what you'll write)        |
| ------------------------------------ | --------------------------------------- |
| `app.post("/input", handler)`        | `ipcMain.handle("pty:input", handler)`  |
| `fetch("/input", {body})` from React | `ipcRenderer.invoke("pty:input", data)` |
| `res.json(result)`                   | `return result` (from the handler)      |
| `req.body`                           | the handler's arguments                 |
| WebSocket push to client             | `webContents.send("pty:data", chunk)`   |
| client `socket.onmessage`            | `ipcRenderer.on("pty:data", cb)`        |

So:

- **Request/response** (button click → do something → get a result) = `invoke`/`handle`.
  Same shape as a REST call.
- **Server push** (terminal output streaming in continuously) = `webContents.send`
  → `ipcRenderer.on`. Same shape as a WebSocket message.

The one extra Electron-only piece (no Express equivalent) is the **preload bridge**:
instead of the renderer calling `ipcRenderer` directly, you expose tidy named
functions on `window.api` (for security). Think of preload as a **typed API client**
you hand to the frontend:

```js
// preload.js — "the API client the frontend is allowed to use"
contextBridge.exposeInMainWorld('api', {
  sendInput: (id, data) => ipcRenderer.invoke('pty:input', { id, data }),
  onPtyData: (cb) => {
    const fn = (_e, msg) => cb(msg)
    ipcRenderer.on('pty:data', fn)
    return () => ipcRenderer.removeListener('pty:data', fn) // for useEffect cleanup
  }
})
```

Then React just calls `window.api.sendInput(...)` — clean, like calling a service.

---

## One-page mental model (tape this to your monitor)

```
  RENDERER (React + xterm)            PRELOAD            MAIN (Node)
  ─────────────────────────         (the API)        ───────────────────
  components, hooks, CSS    ──window.api.x()──►  ipcMain.handle  ─► node-pty / fs / net
  useRef holds xterm        ◄──ipcRenderer.on──  webContents.send ◄─ pty.onData / chokidar
        = "frontend"          = "API client"           = "Express backend"
```

If that diagram makes sense, you're ready to start `LEARNING.md` Block 1 and then M0.
