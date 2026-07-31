# Chapter 4 — IPC: How the Two Processes Talk

> **What you'll learn**
>
> - Why IPC has to exist at all (the wall from Chapter 3 means processes can't call each other directly)
> - The one mental model that makes IPC click instantly: **it's your Express request/response _plus_ a WebSocket push**
> - The three IPC patterns, each with a full worked example and a plain-English walkthrough:
>   1. `ipcRenderer.invoke` + `ipcMain.handle` — async request/response (the workhorse)
>   2. `ipcRenderer.send` + `ipcMain.on` — fire-and-forget
>   3. `webContents.send` + `ipcRenderer.on` — main→renderer **push** (how we stream terminal output)
> - How to design good channel names and payloads
> - The serialization rules — what you can and can't send across the wire (the structured clone algorithm)
> - How errors cross the boundary, and how to handle them
> - The concrete Shepherd channel table you'll actually build against
>
> **Prerequisites:** `03-electron-architecture.md`. You need the two-process model firmly in hand: one **main** process (Node, OS access) and one **renderer** per window (sandboxed React). This chapter is the wire between them.

---

## 4.1 Why IPC exists

Chapter 3 built a wall. The renderer is a sandboxed Chromium tab with no Node access; the main process is a Node runtime with no DOM. That separation buys us security and stability — but it creates an obvious problem:

> If the renderer can't touch Node, and main can't touch the DOM, **how does a
> keystroke in your React terminal ever reach the real `bash` shell in main?**

They can't call each other's functions. They're separate OS processes with separate memory — a variable in main is not visible in the renderer, and vice versa. There's no shared `import`. What they _can_ do is **pass messages.** That message-passing channel is **IPC — Inter-Process Communication.**

This is not exotic. You already do the exact same thing every day, you just call it something else:

> Your React app and your Express server are also separate programs with separate
> memory that can't call each other's functions. They pass messages — HTTP
> requests and responses — over a network wire. **IPC is that same idea, over a
> local pipe instead of the network.**

So don't learn IPC as a strange new Electron concept. Learn it as _"frontend↔backend API calls, minus the network."_ Every instinct you have about designing REST endpoints and handling their responses transfers directly.

```
   RENDERER (React)                                 MAIN (Node)
   ────────────────                                 ───────────
   "the frontend"          ── IPC message ──►        "the backend"
   window.api.sendInput()  ◄── IPC message ──        ipcMain.handle(...)

        ≈ fetch('/input')  over the network  ≈  app.post('/input', ...)
```

> **🔧 In Shepherd:** every one of the three "core loops" from Chapter 1 is IPC.
> You type → an IPC message carries the keystroke to main → node-pty writes it to
> `bash`. The shell prints → main pushes an IPC message back → xterm.js paints it.
> An agent notifies → main pushes an IPC message that lights up the sidebar. If you
> understand IPC, you understand the plumbing of the entire app.

---

## 4.2 The mental model: REST + WebSocket

There are two _shapes_ of communication your app needs, and you already know both from web development:

1. **Request/response.** The frontend asks for something and waits for an answer. "Resize this terminal to 80×24 — did it work?" This is a REST call: `fetch()` out, `await` the response.
2. **Server push.** The backend needs to send data the frontend didn't explicitly ask for, _whenever it happens_. "The shell just printed 4KB of output — here it is. And here's more. And more." The frontend can't poll for this; it needs the server to _push_. On the web, that's a **WebSocket**.

Electron IPC gives you tools for **both shapes**, and mapping them onto what you know is the fastest way to internalize the whole API:

| What you know (web)                      | Electron IPC equivalent                          | Shape            |
| ---------------------------------------- | ------------------------------------------------ | ---------------- |
| `app.post('/input', handler)`            | `ipcMain.handle('pty:input', handler)`           | request/response |
| `await fetch('/input', {body})`          | `await ipcRenderer.invoke('pty:input', payload)` | request/response |
| `res.json(result)`                       | `return result` (from the handler)               | request/response |
| `req.body`                               | the handler's second argument (the payload)      | request/response |
| fire-and-forget `navigator.sendBeacon()` | `ipcRenderer.send('telemetry', evt)`             | one-way          |
| WebSocket **server → client** push       | `webContents.send('pty:data', chunk)`            | push             |
| client `socket.onmessage = ...`          | `ipcRenderer.on('pty:data', cb)`                 | push             |

That table _is_ the chapter. The next three sections just fill in each row with a worked example. Keep this framing in your head: **`invoke`/`handle` is REST; `webContents.send`/`on` is WebSocket; `send`/`on` is a beacon you don't wait on.**

---

## 4.3 Pattern 1 — `invoke` + `handle` (request/response, the workhorse)

This is the one you'll reach for **90% of the time.** The renderer asks main to do something and awaits the result — exactly like calling a REST endpoint. It's a Promise-based, two-way round trip.

**In main — register a handler (like defining a route):**

```ts
// main/ipc.ts
import { ipcMain } from 'electron'
import { ptys } from './pty-store' // Map<paneId, IPty> — Chapter 6

// "Route" name is 'pty:input'. The callback is the "controller".
ipcMain.handle('pty:input', (event, payload: { paneId: string; data: string }) => {
  const pty = ptys.get(payload.paneId)
  if (!pty) {
    throw new Error(`No pty for pane ${payload.paneId}`) // becomes a rejected promise
  }
  pty.write(payload.data) // write the keystroke to the real shell
  return { ok: true } // this value travels back to the renderer
})
```

**In the renderer — call it and await the answer (like `fetch`):**

```ts
// renderer side (in practice wrapped by preload — Chapter 5)
const result = await ipcRenderer.invoke('pty:input', { paneId, data: 'ls\n' })
//    ^ result === { ok: true }
```

Walking through it:

- **`ipcMain.handle('pty:input', cb)`** registers a handler for the `'pty:input'` **channel**. The channel string is exactly like a route path — a name both sides agree on. The callback is your "controller."
- The callback's **first argument is an `event` object** (metadata about _who_ sent this — which `webContents`, useful for replying or for security checks). The **second argument is the payload** the renderer sent — this is your `req.body`.
- **`return { ok: true }`** sends that value back to the renderer. You can return a plain value or a Promise; Electron waits for the Promise to settle. This is your `res.json(...)`.
- On the renderer, **`await ipcRenderer.invoke('pty:input', payload)`** sends the message and returns a **Promise** that resolves with whatever the handler returned. It's `fetch` + `.json()` collapsed into one call.

The symmetry with Express is near-perfect:

```
   ipcMain.handle('pty:input', (e, body) => { ...; return result; })
   ────────────   ──────────    ─   ────       ──────────────────
   app.post(      '/input',     (req, res) => { ...; res.json(result); })
```

> **🔧 In Shepherd:** we use `invoke`/`handle` for every "do a thing and tell me
> how it went" operation: `pty:spawn` (make a new terminal, return its id),
> `pty:input` (send keystrokes), `pty:resize` (change dimensions), and later socket
> API calls proxied through the renderer. If you're unsure which pattern to use,
> default to this one — it's the safest, most debuggable, and the only one that
> gives you a return value _and_ proper error propagation (§4.7).

> **⚠️ Gotcha:** `handle` pairs with `invoke`; `on` pairs with `send`. Mixing them
> silently fails. If you `ipcRenderer.invoke('foo')` but registered the handler
> with `ipcMain.on('foo', ...)`, your `invoke` promise hangs forever waiting for a
> reply that `on` never sends. When an `await` on an IPC call never resolves, this
> mismatch is the first thing to check.

---

## 4.4 Pattern 2 — `send` + `on` (fire-and-forget)

Sometimes the renderer wants to _tell_ main something but doesn't need an answer. No return value, no waiting. This is the one-way pattern: `ipcRenderer.send` from the renderer, `ipcMain.on` in main.

**In the renderer — fire and move on:**

```ts
// renderer: log a UI event; we don't care about a response
ipcRenderer.send('telemetry:event', { name: 'pane_split', dir: 'row' })
```

**In main — receive it, do something, return nothing:**

```ts
// main
ipcMain.on('telemetry:event', (event, evt: { name: string; dir?: string }) => {
  appendToLogFile(evt) // side effect only; nobody is awaiting us
})
```

The differences from Pattern 1:

- **`ipcRenderer.send(...)` returns nothing** (well, `void`) — there's no Promise to await. The renderer keeps executing immediately; it has no idea when (or whether) main handled the message.
- **`ipcMain.on(...)`** is the listener. Whatever it returns is **thrown away** — there's no channel back to the sender. It's a beacon, not a request.

Think of `sendBeacon()` on the web, or a fire-and-forget `POST` where you ignore the response: "record this event, I'm not blocking on it." Use it when the renderer genuinely doesn't need to know the outcome.

> **⚠️ Gotcha:** it's tempting to use `send`/`on` for everything because it looks
> simpler (no `await`). Resist. If you _care whether it worked_ — did the pty
> actually get created? did the write succeed? — you want `invoke`/`handle` so you
> get a result and error propagation. Reach for `send`/`on` only for true
> "notify-and-forget" cases (telemetry, non-critical UI signals). When in doubt,
> use `invoke`.

> **🔧 In Shepherd:** we lean on `invoke`/`handle` far more than `send`/`on`,
> because most renderer→main actions (spawn, write, resize) benefit from a return
> value or an error. `resizePty` is a reasonable candidate for either — a resize
> that silently no-ops if the pane is gone is fine as fire-and-forget — but even
> there we often prefer `invoke` just for the consistency and the error signal.

---

## 4.5 Pattern 3 — `webContents.send` + `ipcRenderer.on` (main → renderer PUSH)

Here's the pattern that's genuinely _different_ from a plain REST app, and it's the beating heart of a terminal: **main initiating a message to the renderer, unprompted.** This is the WebSocket-push shape.

Why do we _need_ it? Because terminal output isn't a response to a request. When you run `npm install`, the shell spews thousands of lines over several seconds. The renderer never "asked" for line 4,712 — main has to **push** each chunk the instant `bash` produces it. There's no request to respond to; main is the initiator.

The tools:

- In **main**, you call `someWindow.webContents.send('channel', payload)`. `webContents` is the handle to a specific window's renderer (its "web page"). This pushes a message _into_ that renderer.
- In the **renderer**, you subscribe with `ipcRenderer.on('channel', callback)`. Your callback fires every time main pushes on that channel — exactly like `socket.onmessage`.

**In main — stream shell output as it arrives:**

```ts
// main: when we spawn a pty (Chapter 6), forward its output to the window
pty.onData((chunk: string) => {
  // push each chunk to the renderer, tagged with which pane it belongs to
  win.webContents.send('pty:data', { paneId, data: chunk })
})

// the shell exited? push that too, so the UI can show "[process completed]"
pty.onExit(({ exitCode }) => {
  win.webContents.send('pty:exit', { paneId, code: exitCode })
})
```

**In the renderer — subscribe and route each chunk to the right terminal:**

```ts
// renderer (again, wrapped by preload in real code — Chapter 5)
ipcRenderer.on('pty:data', (event, msg: { paneId: string; data: string }) => {
  const term = terminalsByPane.get(msg.paneId) // find the right xterm.js instance
  term?.write(msg.data) // paint the bytes
})
```

Walking through it:

- **`win.webContents.send('pty:data', {...})`** is main saying "hey renderer, here's a `pty:data` message." It's one-directional (main→renderer) and fire-and-forget from main's side — main doesn't await the renderer.
- **`ipcRenderer.on('pty:data', cb)`** in the renderer registers a _persistent listener_. Unlike `invoke` (one call, one answer), this fires **every time** a `pty:data` message arrives — potentially hundreds of times a second during heavy output. That's the WebSocket-stream shape.
- We tag every message with **`paneId`** because there are many terminals. The renderer uses that id to route each chunk to the correct xterm.js instance. (This is why Chapter 1's Loop B carries `{paneId, data}` and not just `data`.)

```
        MAIN                                   RENDERER
        ────                                   ────────
   bash prints "file1 file2\n"
        │
   pty.onData(chunk)
        │
   webContents.send('pty:data', ────push───►  ipcRenderer.on('pty:data', cb)
       {paneId, data})                              │
                                             term.write(data)  ← xterm paints
```

> **⚠️ Gotcha (the #1 memory leak in Electron):** `ipcRenderer.on` **adds** a
> listener; it does not replace. If a React component subscribes on every render
> without unsubscribing, you stack up duplicate listeners — output gets written to
> the terminal twice, then three times, then N times, and memory climbs. **Every
> `on` needs a matching `removeListener` on cleanup.** This is exactly what React's
> `useEffect` cleanup is for, and it's why our preload's `onPtyData` returns an
> _unsubscribe function_. Chapter 5 builds that pattern; Chapter 8 wires it into
> `useEffect`.

> **🔧 In Shepherd:** `webContents.send` is also how the **sidebar comes alive**.
> When the socket server (Chapter 11) receives `shepherd notify`, main updates a
> workspace's state and pushes `workspace:update` to the renderer with
> `webContents.send`. React re-renders the sidebar row with its new status and
> ring. Same push mechanism as `pty:data`, different channel — that's the elegance
> of learning the _pattern_ rather than memorizing one-off code.

---

## 4.6 Putting it together: the full pty round-trip

Let's assemble the three patterns into the one flow that defines the app — a single keystroke's journey and the output that follows. This is Chapter 1's Loop A and Loop B, now with real IPC calls:

```
 (1) You press "l" in the terminal (renderer, xterm.js onData fires)
        │  invoke  (Pattern 1)
        ▼
 ipcRenderer.invoke('pty:input', { paneId, data: 'l' })
        │  →  ipcMain.handle('pty:input', ...) runs in MAIN
        ▼
 pty.write('l')     ← node-pty sends the byte to the real bash

 ...bash echoes "l" and, on Enter, runs the command...

 (2) bash prints output (MAIN, pty.onData fires)
        │  webContents.send  (Pattern 3)
        ▼
 win.webContents.send('pty:data', { paneId, data: 'file1  file2\n' })
        │  →  ipcRenderer.on('pty:data', ...) fires in the RENDERER
        ▼
 term.write('file1  file2\n')   ← xterm.js paints it. You see the result.
```

Two IPC hops per interaction: **Pattern 1 going in (invoke/handle), Pattern 3 coming out (webContents.send/on).** That's the whole terminal. Everything else — splits, tabs, the sidebar — is variations on these same hops with different channels and payloads.

---

## 4.7 Designing channels: names and payloads

Because channels are just agreed-upon strings, _you_ design them. A little discipline here pays off enormously in debuggability. Treat channel design exactly like REST endpoint design.

**Name channels with a `namespace:action` convention.** It groups related messages and reads clearly in logs:

```
   pty:spawn        pty:input       pty:data        pty:resize      pty:exit
   workspace:update surface:focus   notification:create
   └── noun ──┘    └── verb ──┘
```

This is the same instinct as `/users/:id/posts` — structure communicates intent. When you see `pty:data` in a log you immediately know its domain (terminals) and its action (data flowing).

**Design payloads as plain, self-describing objects.** Pass a single object argument with named fields rather than positional arguments — it's self-documenting and forgiving to extend:

```ts
// Good: a named-field object. Order-independent, easy to add fields later.
ipcRenderer.invoke('pty:resize', { paneId, cols: 80, rows: 24 })

// Avoid: positional args. Which number is cols? Which is rows? Bug-prone.
ipcRenderer.invoke('pty:resize', paneId, 80, 24)
```

**Always include a routing id.** Because Shepherd has _many_ terminals and workspaces, nearly every message needs a `paneId` (or `workspaceId`, `surfaceId`) so the receiver knows which one it's about. A `pty:data` message without a `paneId` is useless — you wouldn't know which terminal to paint it into.

> **🔧 In Shepherd:** we deliberately mirror this structure everywhere, and it
> pays off in the socket API too (Chapter 11), which uses the _same_ `method` +
> `params` JSON shape (`{ id, method: 'notification.create', params }`). Learning
> one message-design discipline serves both the internal IPC and the external
> socket protocol — they rhyme on purpose.

---

## 4.8 Serialization: what you can and can't send

Here's a rule that will save you a confusing afternoon. IPC messages don't share memory — they're **copied** from one process to the other. Electron serializes your payload using the browser's **Structured Clone Algorithm** (the same one `postMessage` and IndexedDB use). That algorithm can copy a lot, but **not everything.**

**✅ Things that cross the wire fine:**

- Primitives: `string`, `number`, `boolean`, `null`, `undefined`, `BigInt`
- Plain objects and arrays (nested arbitrarily deep)
- `Date`, `RegExp`, `Map`, `Set`
- `ArrayBuffer` and typed arrays (`Uint8Array`, etc.) — useful for raw bytes

**❌ Things that do NOT survive (and why):**

- **Functions.** A function is code bound to _this_ process's memory; it's meaningless in the other process. Trying to send one throws a _"could not be cloned"_ error.
- **Class instances.** The _data_ fields may copy, but the **prototype and methods are lost** — the object arrives as a plain object. If you send a `new PtyProcess()`, the other side gets `{...its fields}` with none of its methods. (So don't send live objects; send plain data snapshots.)
- **DOM nodes**, and anything holding a live handle (a socket, a stream, a file descriptor).
- **Symbols.**

```ts
// ❌ Throws: "An object could not be cloned."
ipcRenderer.invoke('do', { onDone: () => console.log('hi') }) // a function!

// ✅ Fine: plain data only. To signal "done", push a message back instead.
ipcRenderer.invoke('do', { requestId: 'abc', payload: { cols: 80 } })
```

The mental model: **you can only send data, never behavior.** This is identical to the constraint on a REST API — you can `JSON.stringify` your request body, but you can't put a JavaScript function in JSON and have the server call it. If your instinct is "I'll pass a callback so main can call me back when it's done," stop: that's what **Pattern 3 (push)** is for. Main pushes a message back on a channel, and your `ipcRenderer.on` listener is the "callback."

> **⚠️ Gotcha:** the "class instance loses its methods" trap is subtle because it
> doesn't throw — it _silently_ degrades. You send a rich object, the other side
> receives a lookalike with all the data but no methods, and later
> `obj.someMethod()` is `undefined is not a function`. Rule of thumb: **only ever
> put plain JSON-shaped data on the wire.** If you have a class, send
> `instance.toJSON()` or a hand-built plain object, and reconstruct on the other
> side if needed.

---

## 4.9 Error handling across the wire

Because `invoke`/`handle` is Promise-based, errors propagate the way you'd hope — **a throw in main becomes a rejected promise in the renderer.** This is one more reason to prefer Pattern 1.

**In main — just throw (or reject):**

```ts
ipcMain.handle('pty:spawn', async (event, opts: { cwd: string }) => {
  if (!isAllowedCwd(opts.cwd)) {
    throw new Error(`Refusing to spawn in ${opts.cwd}`) // validation failure
  }
  const pty = spawnShell(opts) // could throw if the shell is missing
  return { paneId: pty.paneId }
})
```

**In the renderer — catch it like any async call:**

```ts
try {
  const { paneId } = await ipcRenderer.invoke('pty:spawn', { cwd })
  openTerminal(paneId)
} catch (err) {
  // err.message === "Refusing to spawn in /etc" (or whatever main threw)
  showToast(`Couldn't open terminal: ${(err as Error).message}`)
}
```

A few things to know:

- The **error message crosses the wire**, but a full custom `Error` subclass does _not_ arrive as that subclass (serialization again — you get a generic `Error` with the message and stack, not your `class SpawnError`). So don't rely on `err instanceof MyError` across IPC; branch on a `code` field in the payload instead if you need typed errors.
- With **`send`/`on` (Pattern 2)** there is _no_ error channel — if the handler throws, the renderer never finds out. Another reason fire-and-forget is only for things you truly don't need to confirm.
- With **`webContents.send` (Pattern 3)**, main pushing to a renderer that has since closed is a common source of _"Object has been destroyed"_ errors. Guard with `if (!win.isDestroyed()) win.webContents.send(...)`.

> **🔧 In Shepherd:** a real example — if the renderer asks to spawn a terminal in
> a directory that no longer exists (a restored session pointing at a deleted repo,
> Chapter 13), main throws, the renderer catches it, and the UI shows a friendly
> "couldn't restore this workspace" state instead of crashing. Error propagation
> over `invoke` is what makes that graceful.

---

## 4.10 The Shepherd channel table

Here's the concrete set of channels the app is built around. Keep this as your reference; every feature chapter plugs into one of these rows.

| Channel             | Direction           | Pattern          | Payload → Return                         | Purpose                                     |
| ------------------- | ------------------- | ---------------- | ---------------------------------------- | ------------------------------------------- |
| `pty:spawn`         | renderer → main     | invoke/handle    | `{cwd, shell?, cols, rows}` → `{paneId}` | Create a new terminal; get its id back      |
| `pty:input`         | renderer → main     | invoke/handle    | `{paneId, data}` → `{ok}`                | Send keystrokes to the shell                |
| `pty:resize`        | renderer → main     | invoke/handle    | `{paneId, cols, rows}` → `{ok}`          | Terminal was resized; resize the pty        |
| `pty:data`          | **main → renderer** | webContents.send | `{paneId, data}`                         | Stream shell output to be painted           |
| `pty:exit`          | **main → renderer** | webContents.send | `{paneId, code}`                         | The shell process ended                     |
| `pty:kill`          | renderer → main     | invoke/handle    | `{paneId}` → `{ok}`                      | User closed a pane; kill its shell          |
| `workspace:update`  | **main → renderer** | webContents.send | `{workspace}`                            | Sidebar state changed (from the socket API) |
| `notification:show` | **main → renderer** | webContents.send | `{workspaceId, title, body}`             | An agent needs attention (ring/flash)       |

Read the **Direction** and **Pattern** columns together and the whole architecture snaps into focus:

- **Renderer→main is always `invoke`/`handle`** — the UI asks main to do OS-level work (spawn, write, resize, kill) and wants confirmation.
- **Main→renderer is always `webContents.send`/`on`** — main pushes unsolicited updates (shell output, exit, sidebar state, notifications) as they happen.

That's the two-shape model from §4.2 made real: **requests flow in, pushes flow out.** Every future chapter that adds a feature is really just adding a row to this table.

> **🔧 In Shepherd:** notice `workspace:update` and `notification:show` are the
> _same push pattern_ as `pty:data`. The sidebar's "liveness" (Chapter 1's Loop C)
> is not special machinery — it's `webContents.send` again, on different channels.
> Once you see that, Shepherd's agent round-trip demystifies into: a socket server (Ch. 11)
> feeding the same IPC push you already use for terminal output.

---

## 4.11 Security: never trust the renderer

One principle that shapes how you write every handler. The renderer is a sandboxed web page that renders **untrusted content** (terminal output, and later web pages). If it's ever compromised, the attacker's only lever into the OS is the IPC channels you exposed. So:

> **Treat every IPC message from the renderer exactly like an HTTP request from the
> public internet: validate it in main before acting.**

Concretely, inside your `ipcMain.handle`/`on` callbacks:

- **Validate the payload shape and values.** Don't assume `paneId` is a real, known pane — check your map. Don't assume `cwd` is a safe path — reject `/etc`, path-traversal (`../../..`), or anything outside allowed roots.
- **Don't reflect renderer input into dangerous operations unguarded.** A `pty:spawn` that takes a `shell` path from the renderer and executes it verbatim is a command-injection vector. Whitelist it (`bash`/`zsh`/`$SHELL`), don't eval it.
- **Scope by sender when it matters.** The handler's `event.sender` tells you which window sent the message — useful when one renderer shouldn't be able to act on another's panes.
- **Keep the exposed surface tiny.** The fewer channels you expose, and the narrower each one's contract, the less there is to attack. This is the whole reason the preload bridge (Chapter 5) exposes a handful of named functions instead of raw `ipcRenderer`.

You already do this instinctively on the server — you'd never trust `req.body` from a browser without validation. IPC is the same threat model with the same discipline.

> **⚠️ Gotcha:** it's easy to think "it's my own renderer, it's fine, I control the
> React code." But the renderer displays output from `npm install`, from AI agents
> running arbitrary commands, from any program. A rendering exploit that hijacks
> the renderer inherits _exactly_ the IPC surface you exposed. Validate as if the
> caller were hostile — because one day a bug might make it so.

---

## 🧪 Checkpoint

Answer these before moving on:

1. In one sentence, why does IPC have to exist at all in an Electron app?
2. Map each IPC pattern to its web analogy: `invoke`/`handle`, `send`/`on`, `webContents.send`/`on`. Which is REST? Which is a WebSocket push? Which is a fire-and-forget beacon?
3. Streaming `bash` output to the terminal — which pattern, and in which direction does the message flow? Why can't this be request/response?
4. A colleague passes `{ onComplete: () => refresh() }` as an IPC payload and gets _"could not be cloned."_ Explain what happened and how they should signal completion instead.
5. You send a `class Workspace` instance over IPC and the other side's `workspace.rename()` throws _"not a function."_ What went wrong, and what's the fix?
6. Why is `invoke`/`handle` preferred over `send`/`on` for a `pty:spawn` that might fail?
7. Give two specific validations main should perform on a `pty:spawn` payload from the renderer, and state the principle behind them.

---

## Summary

Because Chapter 3's wall makes main and renderer separate processes that can't call each other's functions, they communicate by **passing messages — IPC**, which is just _frontend↔backend API calls minus the network._ Your app needs two message shapes you already know: **request/response** (like REST) via `ipcRenderer.invoke` + `ipcMain.handle` — the workhorse, used for `pty:spawn`/`input`/`resize` — and **server push** (like a WebSocket) via `webContents.send` + `ipcRenderer.on` — used to stream `pty:data` output and push `workspace:update` sidebar changes. A third pattern, `send` + `on`, is one-way fire-and-forget for things you don't need to confirm. Messages are **copied via structured clone**, so you can send plain data but never functions or live class instances. Errors thrown in an `invoke` handler reject the renderer's promise, giving you clean `try/catch` error handling. Design channels like REST routes (`namespace:action`, named-field payloads, always a routing id), and **validate every renderer message in main** as if it were a hostile HTTP request. Master the Shepherd channel table (requests flow in via `invoke`, pushes flow out via `webContents.send`) and you've mastered the app's entire plumbing.

## Where this shows up next

- Wrapping these raw IPC calls into a safe `window.api` (so the renderer never touches `ipcRenderer`) → `05-preload-and-context-isolation.md`
- What main _does_ on `pty:input`/`pty:data` — driving the real shell → `06-node-pty.md`
- What the renderer does with `pty:data` — painting it → `07-xtermjs.md`
- Subscribing to pushes inside React (and cleaning up listeners) → `08-react-in-this-app.md`
- The socket server that emits `workspace:update` → `11-the-socket-api.md`
- The notification pipeline behind `notification:show` → `12-notifications-and-osc.md`
- The end-to-end keystroke + notification trace that stitches every channel together → `17-how-it-all-connects.md`

## Further reading

- Electron — Inter-Process Communication (read the whole page): https://www.electronjs.org/docs/latest/tutorial/ipc
- Electron — `ipcMain` API: https://www.electronjs.org/docs/latest/api/ipc-main
- Electron — `ipcRenderer` API: https://www.electronjs.org/docs/latest/api/ipc-renderer
- Electron — `webContents.send` (and the WebContents API): https://www.electronjs.org/docs/latest/api/web-contents#contentssendchannel-args
- MDN — The structured clone algorithm (what can/can't be sent): https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
