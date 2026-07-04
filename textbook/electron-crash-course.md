# ⚡ Electron Crash Course (do this before the deep chapters)

A **hands-on, zero-to-working** intro to Electron. In ~30–45 minutes you'll build a
tiny app that contains the *entire* mental model cmux-linux is built on. No Vite,
no TypeScript, no build tools yet — just plain JavaScript so you learn **Electron
itself**, not the tooling. (The real project adds TS + Vite later; those are easy
once the model below clicks.)

> **How to use this:** actually type it out and run it. Reading Electron docs is
> fine, but the two-process model only really lands when you *see* a button in a
> window trigger code in a Node backend and get an answer back.

---

## 1. The one-sentence model

> **An Electron app = a Node.js backend (the "main" process) + a Chromium window
> running a web page (the "renderer" process), talking over a message channel (IPC).**

That's it. If you know Express + a frontend, you know 80% of this already:
- **main process** ≈ your Express backend (full OS access: files, processes, network)
- **renderer process** ≈ your frontend (HTML/CSS/JS in a sandboxed browser window)
- **IPC** ≈ the API calls between them
- **preload** ≈ a small, safe "API client" the backend hands to the frontend

```
   ┌─────────────────────────┐        ┌─────────────────────────┐
   │  RENDERER (a browser)    │  IPC   │  MAIN (Node.js)         │
   │  index.html + renderer.js│◄──────►│  main.js                │
   │  "the frontend"          │preload │  "the backend"          │
   └─────────────────────────┘        └─────────────────────────┘
```

---

## 2. Set up the project (2 minutes)

```bash
mkdir electron-crash-course && cd electron-crash-course
npm init -y
npm install --save-dev electron
```

Then create the five files below in that folder.

> **⚠️ Gotcha:** Electron needs a `"main"` entry in `package.json` (the main-process
> file to run) and a `start` script. We set both next.

**`package.json`** (edit the generated one to look like this):
```json
{
  "name": "electron-crash-course",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron ."
  },
  "devDependencies": {
    "electron": "^31.0.0"
  }
}
```

---

## 3. Example 1 — Open a window

**`main.js`** — the backend. It creates a window and loads a web page into it.
```js
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // the safe bridge (Example 2)
      contextIsolation: true,   // keep the page sandboxed (secure default)
      nodeIntegration: false,   // the page canNOT use Node directly (secure default)
    },
  });
  win.loadFile('index.html'); // load our web page into the window
}

// app.whenReady() fires once Electron is initialized — then we can open windows.
app.whenReady().then(() => {
  createWindow();

  // macOS convention: re-open a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed (except on macOS, where apps stay running).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

**`index.html`** — the web page shown in the window.
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Electron Crash Course</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; background:#111; color:#eee; }
      button { padding: 6px 12px; }
      input { padding: 6px; }
      h2 { margin-top: 28px; }
      .box { background:#1b1b1b; padding:14px; border-radius:8px; }
    </style>
  </head>
  <body>
    <h1>⚡ Electron Crash Course</h1>

    <h2>Example 2 — ask the backend a question</h2>
    <div class="box">
      <input id="name" placeholder="your name" />
      <button id="pingBtn">Ping main</button>
      <p id="reply"></p>
    </div>

    <h2>Example 3 — the backend pushes data to us</h2>
    <div class="box">
      Clock streamed from main: <strong><span id="clock">…</span></strong>
    </div>

    <script src="renderer.js"></script>
  </body>
</html>
```

At this point you can already run it:
```bash
npm start
```
A window opens showing the page. 🎉 You just made a desktop app. The buttons don't
work yet — that needs IPC, which is Examples 2 and 3.

---

## 4. Example 2 — IPC request/response (renderer → main → renderer)

This is the **most important pattern**. It's exactly like calling an API endpoint,
except the "server" is your main process.

**`preload.js`** — the safe bridge. It exposes a tidy `window.api` to the page.
The page will call `window.api.ping(...)` and never touches raw IPC.
```js
const { contextBridge, ipcRenderer } = require('electron');

// Whatever we put here becomes `window.api` inside the web page.
contextBridge.exposeInMainWorld('api', {
  // Request/response: send a name to main, await the reply.
  ping: (name) => ipcRenderer.invoke('ping', name),

  // Subscribe to a stream of pushes from main (used in Example 3).
  // Returns an "unsubscribe" function — important for cleanup.
  onTick: (callback) => {
    const listener = (_event, time) => callback(time);
    ipcRenderer.on('tick', listener);
    return () => ipcRenderer.removeListener('tick', listener);
  },
});
```

Add the **handler** in `main.js` (put it above `app.whenReady()`):
```js
const { ipcMain } = require('electron'); // add ipcMain to the top require

// When the renderer calls window.api.ping(name), THIS runs in the backend.
// Whatever you return becomes the reply the renderer awaits.
ipcMain.handle('ping', async (_event, name) => {
  return `Hello ${name || 'stranger'} — this reply came from the Node backend!`;
});
```

**`renderer.js`** — runs in the page. It can *only* use `window.api`.
```js
// Note: no `require`, no Node here. The renderer is sandboxed.
// It talks to the backend exclusively through window.api (from preload).

document.getElementById('pingBtn').addEventListener('click', async () => {
  const name = document.getElementById('name').value;
  const reply = await window.api.ping(name); // → IPC → main → back
  document.getElementById('reply').textContent = reply;
});
```

Run `npm start` again, type your name, click **Ping main** → the reply text is
produced *in the Node backend* and shown in the window. **That round trip is the
heartbeat of every Electron app.**

> **🔧 In cmux-linux:** this exact pattern is how the UI will ask the backend to
> "create a workspace," "split a pane," or "send this keystroke to the shell."
> `window.api.ping` becomes `window.api.sendInput`, etc.

---

## 5. Example 3 — main pushes to the renderer (streaming)

Request/response is renderer-initiated. But sometimes the **backend** needs to push
data whenever *it* wants — like a clock ticking, or terminal output arriving. That's
`webContents.send` (main) → `ipcRenderer.on` (renderer).

Add to `main.js` inside `app.whenReady().then(() => { ... })`, after `createWindow()`:
```js
  // Every second, push the current time to the window.
  setInterval(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('tick', new Date().toLocaleTimeString());
  }, 1000);
```

Add to `renderer.js`:
```js
// Subscribe to the 'tick' stream. onTick returns an unsubscribe function.
const stopClock = window.api.onTick((time) => {
  document.getElementById('clock').textContent = time;
});
// If you ever wanted to stop receiving ticks: stopClock();
```

Run `npm start` → the clock updates every second, **pushed from the backend.**

> **🔧 In cmux-linux:** replace "a clock tick every second" with "a chunk of
> terminal output whenever the shell prints," and this *is* how a live terminal
> streams into the UI. Replace it with "a workspace status changed" and it's how
> the sidebar lights up. Same pattern, different payload.

---

## 6. You just learned the whole skeleton

Those three examples map 1:1 onto cmux-linux:

| Crash-course example | The real cmux-linux feature it becomes |
|---|---|
| Example 1 — open a window | The app shell (sidebar + panes live here) |
| Example 2 — `ping` request/response | "create workspace", "split pane", "send keystroke" |
| Example 3 — `tick` push | Terminal output streaming in; sidebar status updates |
| `preload.js` `window.api` | The real `window.api` (sendInput, onPtyData, …) |
| `contextIsolation`/`nodeIntegration:false` | The same security settings we ship with |

If you understand this tiny app, you understand the architecture of the whole
project. Everything else is adding **node-pty** (real shells behind Example 3's
stream) and **xterm.js** (a real terminal instead of a clock), then a lot of React
and CSS you already know.

---

## 7. Troubleshooting

- **Blank window / page won't load** → check `win.loadFile('index.html')` path and
  that `index.html` is in the project root.
- **`window.api` is undefined** → the `preload` path in `webPreferences` is wrong,
  or you edited `preload.js` but it's not being loaded. It must be an absolute path
  (`path.join(__dirname, 'preload.js')`).
- **Button does nothing** → open DevTools (add `win.webContents.openDevTools()` in
  `createWindow`) and check the Console for errors.
- **"require is not defined" in renderer.js** → correct! The renderer is sandboxed;
  use `window.api` (from preload), not `require`.

---

## 8. How long will this take to learn?

Honest estimates for **you** (already fluent in React/Node/Express). "Part-time" =
~1–2 hrs an evening.

| Goal | Time | What it involves |
|---|---|---|
| **"I get Electron"** | **1 afternoon (2–4 hrs)** | Do this crash course; run all 3 examples; tweak them |
| **Comfortable with the core** | **~1 week part-time** | This + textbook ch `03`,`04`,`05` (Electron/IPC/preload) + `06` node-pty + `07` xterm.js |
| **Ready to build M1** | **~1 week part-time** | The above, then build the one-terminal milestone (learning cements while building) |
| **Understand the whole stack** | **~3–4 weeks part-time** | Best done *while* building M0→M4; read chapters as each milestone needs them |
| **Read the full textbook cover-to-cover** | **~15–25 hrs total** | Optional/reference — you do NOT need this before starting |

**The fast path (recommended):** crash course (1 afternoon) → skim textbook ch
`01`,`02` → build M0 → read ch `03`–`07` → build M1. That's roughly **one to two
weeks part-time to a working terminal you built yourself.**

> **The single biggest accelerator:** don't try to master Electron before building.
> You're vibe-coding — you'll learn far faster reading *working* code as we scaffold
> each milestone than by studying docs cold. The book is there to explain *why*
> whenever something is unclear, not to be finished first.

---

## Where this shows up next
- Go deeper on each piece you just met:
  `03-electron-architecture.md`, `04-ipc-inter-process-communication.md`, `05-preload-and-context-isolation.md`
- Real shells behind the stream: `06-node-pty.md` · Real terminal UI: `07-xtermjs.md`
- The whole picture again, now that it'll click: `01-the-big-picture.md`

## Further reading
- Electron — Quick Start: https://www.electronjs.org/docs/latest/tutorial/quick-start
- Electron — Process Model: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron — IPC: https://www.electronjs.org/docs/latest/tutorial/ipc
