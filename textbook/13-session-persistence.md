# Chapter 13 — Session Persistence

> **What you'll learn**
>
> - Why "restore my workspace on relaunch" is a _serialization_ problem, not a _save-the-processes_ problem
> - Exactly **what** to write to disk (the object-model tree + each terminal's cwd + optional scrollback) and **what you fundamentally cannot** (live pty processes)
> - Which pieces of state live in the **main** process vs the **renderer**, and why that dictates how you serialize
> - **Where** to store the snapshot (`app.getPath('userData')`), **when** to save (debounced + on quit), and how to write it atomically
> - The full **restore flow** on launch, including the handshake that stops you from racing the renderer
> - How to strip secrets, survive a corrupt/old snapshot, and design the "restore previous session?" UX
>
> **Prerequisites:** Chapter 09 (the Window→Workspace→Pane→Surface→Panel data model — you're about to serialize exactly that tree) and Chapter 11 (the socket API and the fact that **the main process is the source of truth** for all this state). A passing memory of Chapter 06 (node-pty) and Chapter 07 (xterm.js) helps, because restore re-spawns the former and replays into the latter.

---

## 13.1 The goal: pick up exactly where you left off

Close the app with three workspaces open — `api-refactor` on branch `feat/auth`, `docs` scrolled halfway down a build log, `scratch` sitting at a shell prompt in `~/experiments` — reopen it, and **all three are back**: same sidebar order, same split layout, same tabs, each terminal sitting in the same directory it was in, ideally showing the same scrollback you were reading. No re-navigating, no re-splitting, no "wait, which folder was this one in?"

That's session persistence. It's the difference between an app that feels like a _tool you live in_ and one that feels like a _demo you re-set-up every morning_. cmux does it; `ROADMAP.md` puts it in **M4** ("the workspace survives a restart") and `FEATURES.md` lists it as 🟢 Core (layout + cwd) with scrollback as a 🟡 polish follow-up.

> **Current Shepherd policy:** this chapter develops the general full-session
> design space. The shipped application now treats launch as a one-workspace
> boundary: it resumes only the previously active workspace's layout, cwd, and
> validated bounded notification inbox. Runtime multi-workspace use is unchanged.
> Chapters 12 and 24 explain inbox sanitization, implementation, compatibility,
> alternatives, and tradeoffs.

Here's the mental model before any code. Persistence is two mirror-image operations:

```
   SHUTDOWN                                    STARTUP
   ────────                                    ───────
   in-memory object model   ──serialize──►     session.json on disk
   (the live app state)         (to JSON)              │
                                                       │ read + validate
                                                       ▼
                                          rebuild the object model
                                          re-spawn shells in saved cwds
                                          replay saved scrollback
                                                       │
                                                       ▼
                                          a window that looks identical
```

The word doing all the work is **serialize**: turn a live, in-memory tree of objects (with functions, event listeners, and OS handles hanging off it) into a flat, boring, re-readable string. Everything hard about this chapter is a consequence of one fact: **some of what's in memory can be turned into a string, and some of it absolutely cannot.**

---

## 13.2 What "state" even is here (and where it lives)

Chapter 09 gave you the object model. Chapter 11 hammered the punchline: **the main process holds the source of truth.** Persistence is where those two facts collide, because to serialize the app you first have to know _where each piece of state physically lives_. It is not all in one place.

```
┌────────────────────────── MAIN PROCESS (Node) ──────────────────────────┐
│  THE SOURCE OF TRUTH — the object-model tree lives here:                 │
│    Window → Workspace → Pane(layout) → Surface → Panel                   │
│    workspace names, cwd config, git branch, layout sizes, active IDs     │
│    the map of  ptyId → live node-pty process   ← NOT serializable        │
└──────────────────────────────────────────────────────────────────────────┘
                              ▲   │
                    IPC push  │   │  IPC push (pty output)
                              │   ▼
┌───────────────────────── RENDERER PROCESS (React) ───────────────────────┐
│  A rendering of that tree + one piece of state main does NOT own:        │
│    each xterm.js instance's SCROLLBACK BUFFER  ← lives only here          │
└──────────────────────────────────────────────────────────────────────────┘
```

Read that diagram twice, because it decides your whole design:

- **The structural state** — the shape of the tree, names, layout sizes, which surface is active, the _configured_ cwd — lives in main and is trivially serializable. This is the part you must never lose.
- **The live pty processes** — real OS child processes — live in main too, but are **not** serializable (§13.3). You throw them away and re-create them.
- **The scrollback** — the actual text history painted into each terminal — lives _only in the renderer_, inside each xterm.js `Terminal` object's buffer. Main has never seen it as text; it only ever forwarded bytes through IPC. So to persist scrollback, main has to _ask the renderer for it_ (§13.4).

> **🔧 In Shepherd:** this is the same "main owns the model, the renderer owns the picture" split from Chapter 01, showing up as a concrete engineering constraint. cwd + layout are cheap to save because they're already in main. Scrollback is expensive to save because it's on the wrong side of the IPC boundary. That single asymmetry is why scrollback is a 🟡 stretch and cwd is 🟢 core.

---

## 13.3 What you can serialize — and what you fundamentally cannot

**JSON can only hold data.** Strings, numbers, booleans, arrays, plain objects, `null`. It cannot hold a function, a socket, a file descriptor, or a running process. That's not a limitation of your code — it's what "serialize" _means_.

So walk the object model and sort every field into two piles:

| Serializable (goes in the JSON)                  | NOT serializable (must be re-created)                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Workspace `id`, `name`, configured `cwd`         | The live `node-pty` process (`IPty`)                                                     |
| Layout tree: `split`/`leaf`, `dir`, `sizes[]`    | The pty's file descriptor + OS PID                                                       |
| Surface `id`, `title`, `activeSurfaceId`         | The process's **in-memory state** (env, open files, half-typed command, a running `vim`) |
| Panel `type`, and for terminals the resolved cwd | The xterm.js `Terminal` object + its addons                                              |
| Git branch, ports (cheap re-derivable metadata)  | IPC channels, event listeners, timers                                                    |

The line in the middle of that table is the single most important idea in the chapter, so let's say it plainly:

> **You are not saving processes. You are saving a _recipe for re-creating_ processes.**

When you "restore a terminal," you do **not** resurrect the exact bash that was running. That process is gone the instant the app quit — its memory, its child processes, its half-run `npm test`, all reaped by the OS. What you saved was one string: the **cwd**. On restore you spawn a _brand-new_ shell and `cd` it into that directory. It _looks_ like the same terminal because it's sitting in the same folder, but it has no memory of what came before.

> **⚠️ Gotcha:** users will expect more than you can deliver, so set the expectation in the UI. If someone had `npm run dev` running in a pane and restarts the app, that dev server is **dead** and will not come back on its own — you restored the _directory_, not the _running command_. This is not a bug you can fix; it's physics. You cannot snapshot the memory of a live Unix process and reanimate it from JSON. (Full-VM snapshotting tools can freeze a _whole machine_, but a desktop app serializing to a config file cannot, and shouldn't pretend to.)

### Why you can't just "save the pty and reopen it"

New developers often ask: node-pty gave me a process handle — can't I store _that_? No. The handle is a live object in this process's memory: a PID, a master file descriptor, and event emitters. When the process exits, the OS destroys the child, closes the fd, and recycles the PID. A number like `pid: 48213` written to JSON is meaningless tomorrow — that PID is either unused or belongs to something else entirely. There is nothing to "reopen." The only durable fact about a terminal is _where it was pointed_ — its cwd — which is exactly what we save.

---

## 13.4 The scrollback question (and the IPC dance it forces)

"Ideally restore scrollback too" sounds small and is the trickiest part, purely because of _where_ scrollback lives (§13.2): only in the renderer.

xterm.js ships an official addon for exactly this: **`@xterm/addon-serialize`**. It walks a `Terminal`'s buffer and produces a single string of text _plus the escape sequences_ that recreate the colors, bold, cursor position, and so on. Feed that string back into a fresh terminal with `term.write(...)` and the history reappears, styled correctly.

```ts
// renderer — producing a scrollback snapshot for one terminal
import { SerializeAddon } from '@xterm/addon-serialize'

const serializer = new SerializeAddon()
term.loadAddon(serializer)

// later, when main asks for a snapshot of this pane:
const scrollback: string = serializer.serialize({ scrollback: 1000 })
// → a string of text + ANSI/VT sequences, replayable via term.write()
```

But main is the one writing `session.json`, and main doesn't have that string. So persisting scrollback is an **IPC round-trip** (Chapter 04): the renderer has to hand its buffers _up_ to main. Two ways to arrange it:

1. **Pull on save** — when main decides to save, it `webContents.send('session:collectScrollback')`, each Terminal replies with `{ paneId, scrollback }`, main waits for all replies, then writes the file. Accurate, but asynchronous and racy at quit time (§13.7).
2. **Push on a throttle** — each Terminal, on a throttle (say every few seconds of activity), sends its serialized buffer up, and main _caches the latest per paneId_. When it's time to save, main already has the last-known scrollback in hand — no waiting.

We use **push-on-a-throttle**. It makes saving synchronous from main's point of view (everything it needs is already local), which is exactly what you want during the frantic moment of `before-quit` (§13.7).

```ts
// renderer — push scrollback up on a throttle so main always has a recent copy
import { throttle } from 'lodash-es'

const pushScrollback = throttle(
  () => {
    window.api.session.cacheScrollback(paneId, serializer.serialize({ scrollback: 1000 }))
  },
  3000,
  { leading: false, trailing: true }
)

term.onData(pushScrollback) // any activity refreshes the cached copy
term.onWriteParsed(pushScrollback)
```

```ts
// main — cache the latest scrollback per pane; serializeWindow() reads from here
const scrollbackCache = new Map<string, string>()
ipcMain.on('session:cacheScrollback', (_e, paneId: string, dump: string) => {
  scrollbackCache.set(paneId, dump)
})
```

> **🔧 In Shepherd:** notice we cap `serialize({ scrollback: 1000 })`. A terminal that printed a 200k-line log would otherwise write a 200k-line string into `session.json` _for every pane_, and you'd be saving that every few seconds. Cap the persisted history to something human (500–2000 lines). Scrollback persistence is a nicety, not an archive.

> **⚠️ Gotcha (privacy):** scrollback is _literal terminal text_. If a command printed an API token, a connection string, or someone typed a password that got echoed, that secret is now sitting in `session.json` in plaintext. §13.6 covers file permissions; §13.9 covers stripping. If you can't stomach that risk for a given workspace, make scrollback persistence opt-in.

---

## 13.5 The security cut: never persist the environment

Chapter 06 taught you that each pane's shell is spawned with an injected environment — `SHEPHERD_WORKSPACE_ID`, `SHEPHERD_SURFACE_ID`, `SHEPHERD_SOCKET_PATH` — _on top of_ the inherited parent environment. When you serialize a pane, there's a tempting shortcut: "save the pane's full `env` so I can re-inject it verbatim on restore." **Do not do this.**

A developer's environment is a minefield of secrets: `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `NPM_TOKEN`, database URLs with embedded passwords. Writing that to a JSON file on disk is how you turn "my laptop was borrowed for five minutes" into "my org's cloud account is compromised."

The rule is a hard allowlist:

```ts
// main — DO NOT serialize the pane's environment. Re-derive only what we own.
// On restore, these are recomputed from the restored workspace/surface IDs:
function envForRestoredPane(ws: Workspace, surface: Surface): Record<string, string> {
  return {
    SHEPHERD_WORKSPACE_ID: ws.id,
    SHEPHERD_SURFACE_ID: surface.id,
    SHEPHERD_SOCKET_PATH: SOCKET_PATH // the current run's socket (Chapter 11)
  }
  // Everything else is inherited fresh from process.env at spawn time — never from disk.
}
```

The insight: the `SHEPHERD_*` vars are the _only_ env we control, and they're
**re-derivable** from IDs we already saved. Everything else (`PATH`, `HOME`,
tokens) comes from the _fresh_ environment of whatever launched the app this
time. So there is never a reason to persist env at all, which conveniently means
there's never a token in your session file _from_ the env. (Scrollback can still
leak one; that's a separate axis, §13.4/§13.9.)

> **⚠️ Gotcha:** re-deriving `SHEPHERD_SOCKET_PATH` from _this run's_ socket (not the saved one) matters. The socket path can include a PID or a per-run temp dir. A restored pane that phones home to _last run's_ dead socket would silently fail to update the sidebar. Always re-derive live values on restore; only persist stable identity (the IDs).

---

## 13.6 WHERE to store it: `app.getPath('userData')`, versioned and atomic

Electron hands you the correct per-user, per-app config directory for free:

```ts
import { app } from 'electron'
import { join } from 'node:path'

// On Linux this resolves to ~/.config/shepherd
const userData = app.getPath('userData')
const SESSION_FILE = join(userData, 'session.json')
```

On Linux `app.getPath('userData')` is `~/.config/<productName>/`, i.e. `~/.config/shepherd/`. Use it — never hardcode a path, never write next to the executable (an AppImage is read-only; see Chapter 15), never dump into `/tmp` (it's wiped on reboot, which defeats the entire feature).

**Version the snapshot.** Your object model _will_ change shape between releases — you'll add a field, rename another, restructure the layout tree. A `session.json` written by v0.3 and read by v0.9 must not crash v0.9. So stamp every snapshot with a schema version:

```jsonc
{
  "version": 3, // schema version, bumped when the shape changes
  "savedAt": "2026-07-02T14:03:11.902Z",
  "window": {/* the serialized tree — see §13.7 */}
}
```

That `version` field is what lets §13.9 migrate or safely discard an old file instead of exploding on a missing property.

**Write atomically.** If the app is killed mid-write, a naive `writeFile` can leave a half-written, truncated `session.json` — corrupt, and you've _destroyed the good copy you were overwriting_. The fix is the classic write-temp-then-rename dance. `rename` is atomic on Linux: the file is either the whole old version or the whole new one, never a torn middle.

```ts
import { writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs'

function writeSnapshotAtomic(snapshot: object): void {
  const tmp = `${SESSION_FILE}.tmp`
  const bak = `${SESSION_FILE}.bak`

  // keep the last-known-good as a backup before we touch the real file
  if (existsSync(SESSION_FILE)) copyFileSync(SESSION_FILE, bak)

  writeFileSync(tmp, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
  renameSync(tmp, SESSION_FILE) // atomic swap: no torn file is ever visible
}
```

Two details earn their keep: `mode: 0o600` makes the file readable/writable **only by the owning user** (relevant because scrollback may hold secrets, §13.4), and the `.bak` copy gives §13.9 something to fall back to if the current file ever fails to parse.

---

## 13.7 WHEN to save: debounced on change, and a guaranteed flush on quit

Two triggers, for two different reasons.

**1. Debounced, on every state change.** Any time the object model mutates — you split a pane, rename a workspace, switch tabs, a shell changes directory — schedule a save. But mutations come in bursts (dragging a divider fires dozens of resize events), and writing the file on every one would thrash the disk. So **debounce**: coalesce a storm of changes into one write a moment after they settle.

```ts
import { debounce } from 'lodash-es'

// wait 800ms after the LAST change, then write once
const scheduleSave = debounce(
  () => {
    writeSnapshotAtomic(buildSnapshot()) // buildSnapshot() wraps serializeWindow()
  },
  800,
  { maxWait: 5000 }
) // ...but never wait more than 5s

// call scheduleSave() from every mutation site (split, rename, focus, cwd-change, ...)
```

`maxWait` guarantees that during _continuous_ activity you still flush at least every 5 seconds, so a crash never loses more than a few seconds of structural changes.

**2. A synchronous flush on quit.** Debounced saves have a fatal edge: if you quit _during_ the 800ms window, the pending save never fires and you lose the last change. So on the way out, force one final, **synchronous** write:

```ts
app.on('before-quit', () => {
  scheduleSave.flush?.() // fire any pending debounced save immediately
  writeSnapshotAtomic(buildSnapshot()) // and one guaranteed synchronous write
})
```

> **⚠️ Gotcha:** `before-quit` is not a place for `await`. The app is tearing down; timers and microtasks may not run, IPC replies may never arrive. This is precisely _why_ we chose push-on-a-throttle for scrollback in §13.4 — at quit time main already holds every pane's cwd (in its store) and last-known scrollback (in `scrollbackCache`), so `buildSnapshot()` is a pure, synchronous read of local memory. If you'd chosen "pull scrollback on save," you'd be trying to `await` an IPC round-trip from a process that's actively dying. It won't finish, and your quit-time save will silently drop scrollback.

---

## 13.8 Worked example: `serializeWindow()`

Now the centerpiece. `serializeWindow()` walks the live object model (Chapter 09) and returns a plain, JSON-safe object — dropping everything from the "not serializable" column of §13.3 and pulling in the two derived facts we care about: each terminal's **live cwd** and its **cached scrollback**.

First, the shape we're producing. Keep these serialized types deliberately separate from your live types — they're a _storage contract_, versioned independently:

```ts
// shared/session-types.ts — the on-disk schema (v3)
interface SerializedPanel {
  type: 'terminal' | 'preview'
  cwd?: string // terminals: the resolved working directory at save time
  scrollback?: string // terminals: optional @xterm/addon-serialize dump
  url?: string // preview panels: revalidated HTTP(S) loopback URL
}
interface SerializedSurface {
  id: string
  title: string
  panel: SerializedPanel
}
interface SerializedPane {
  id: string
  surfaces: SerializedSurface[]
  activeSurfaceId: string
}
type SerializedLayout =
  | { kind: 'leaf'; pane: SerializedPane }
  | { kind: 'split'; dir: 'row' | 'col'; sizes: number[]; children: SerializedLayout[] }
interface SerializedWorkspace {
  id: string
  name: string
  cwd: string
  layout: SerializedLayout
}
interface SerializedWindow {
  activeWorkspaceId: string
  workspaces: SerializedWorkspace[]
}
```

Now the function. The one Linux-specific trick: to get a shell's _current_ directory (not the one it started in — the user may have `cd`'d ten folders deep), read the `/proc/<pid>/cwd` symlink. node-pty gave us the child's PID (Chapter 06).

```ts
// main/session/serialize.ts
import { readlinkSync } from 'node:fs'

/** The live cwd of a running shell, via Linux /proc. Returns undefined if the process is gone. */
function ptyCwd(pid: number): string | undefined {
  try {
    return readlinkSync(`/proc/${pid}/cwd`) // Linux: the shell's CURRENT directory
  } catch {
    return undefined // process already exited, or /proc unavailable
  }
}

function serializePanel(panel: Panel): SerializedPanel {
  if (panel.type !== 'terminal') return { type: panel.type, url: panel.url }
  const pty = ptyProcesses.get(panel.ptyId!) // main's ptyId → live process map
  return {
    type: 'terminal',
    cwd: pty ? ptyCwd(pty.pid) : undefined, // the recipe, not the process
    scrollback: scrollbackCache.get(panel.paneId) // from §13.4's throttled push
  }
}

function serializeLayout(node: PaneNode): SerializedLayout {
  if (node.kind === 'leaf') {
    return {
      kind: 'leaf',
      pane: {
        id: node.pane.id,
        activeSurfaceId: node.pane.activeSurfaceId,
        surfaces: node.pane.surfaces.map((s) => ({
          id: s.id,
          title: s.title,
          panel: serializePanel(s.panel)
        }))
      }
    }
  }
  return {
    kind: 'split',
    dir: node.dir,
    sizes: node.sizes, // the divider positions (Chapter 10)
    children: node.children.map(serializeLayout) // recurse the split tree
  }
}

export function serializeWindow(win: Window): SerializedWindow {
  return {
    activeWorkspaceId: win.activeWorkspaceId,
    workspaces: win.workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      cwd: ws.cwd,
      layout: serializeLayout(ws.layout) // the whole split tree, recursively
    }))
  }
}

// buildSnapshot() from §13.7 just wraps this with the version envelope:
function buildSnapshot() {
  return { version: 3, savedAt: new Date().toISOString(), window: serializeWindow(currentWindow) }
}
```

**Walkthrough.** `serializeWindow` maps each workspace to a plain object and recurses into its layout. `serializeLayout` is a textbook tree walk: a `leaf` serializes its pane (and each surface's panel); a `split` records its direction and `sizes` (the divider positions from Chapter 10's tiling) and recurses into children. `serializePanel` is where the two "not-in-memory-as-data" facts get pulled in: the **cwd** via `/proc`, and the **scrollback** from the cache. Nowhere do we touch the `IPty` object, an event listener, or a file descriptor — every field in the output is a string, number, array, or plain object, so `JSON.stringify` can't choke.

---

## 13.9 The restore flow: `restoreOnReady()`

Restore is the mirror image, and its ordering is _load-bearing_. Get the sequence wrong and you'll either paint a terminal before its history is ready, or push live output into a component that hasn't mounted yet. Here's the target sequence:

```
1. app ready          → read + validate + migrate session.json  (main, no spawning yet)
2. createWindow()     → BrowserWindow loads the renderer
3. renderer mounts    → React tree is alive → sends 'session:ready'  ← the handshake
4. main replies       → 'session:restore' with the serialized tree
5. renderer rebuilds  → workspaces, panes, surfaces; each Terminal mounts an xterm
6. per terminal:        FIRST replay scrollback into xterm, THEN send 'pty:attach'
7. main spawns         a FRESH node-pty in the saved cwd, wires onData → the pane
8. live output          now flows on top of the replayed history
```

The main-process half:

```ts
// main/session/restore.ts
import { app, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

app.whenReady().then(() => {
  const snapshot = loadSnapshot() // §13.9a — validated + migrated, or null
  const win = createWindow()

  // (3→4) Wait for the renderer to say it's mounted before pushing state.
  ipcMain.once('session:ready', () => {
    win.webContents.send('session:restore', snapshot?.window ?? null) // null ⇒ fresh start
  })

  // (6→7) Each Terminal, AFTER replaying its scrollback, asks main to attach a live shell.
  ipcMain.on(
    'pty:attach',
    (
      _e,
      req: {
        paneId: string
        wsId: string
        surfaceId: string
        cwd?: string
        cols: number
        rows: number
      }
    ) => {
      const ws = win.workspaces.find((w) => w.id === req.wsId)!
      const surface = findSurface(ws, req.surfaceId)!
      const pty = spawnPty({
        cwd: safeCwd(req.cwd, ws.cwd), // §13.9b — never spawn into a dead dir
        cols: req.cols,
        rows: req.rows,
        env: { ...process.env, ...envForRestoredPane(ws, surface) } // §13.5 — re-derived, no secrets
      })
      wirePtyToRenderer(req.paneId, pty) // onData → webContents.send (Chapters 04/06)
    }
  )
})
```

### 13.9a Loading defensively: validate, migrate, or discard

`loadSnapshot()` must treat the file as **hostile input**. It might be missing, truncated, hand-edited into invalid JSON, or written by an older schema. Every one of those must degrade to "start fresh," never to a crash:

```ts
import { readFileSync, existsSync, copyFileSync } from 'node:fs'

const CURRENT_VERSION = 3

function loadSnapshot(): Snapshot | null {
  for (const path of [SESSION_FILE, `${SESSION_FILE}.bak`]) {
    // try main, then the backup
    if (!existsSync(path)) continue
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      const migrated = migrate(raw) // bring old schemas up to CURRENT_VERSION
      if (migrated.version !== CURRENT_VERSION) throw new Error('unmigratable version')
      return migrated
    } catch (err) {
      console.warn(`[session] ${path} unreadable, trying next: ${(err as Error).message}`)
      // quarantine the bad file so we don't fight it every launch
      try {
        copyFileSync(path, `${path}.corrupt-${Date.now()}`)
      } catch {}
    }
  }
  return null // nothing usable → clean, fresh start (never a crash)
}

function migrate(raw: any): Snapshot {
  let s = raw
  if (s.version === 1) {
    s = { ...s, version: 2, window: { ...s.window, activeWorkspaceId: s.window.workspaces[0]?.id } }
  }
  if (s.version === 2) {
    s = { ...s, version: 3 /* e.g. add default layout.sizes */ }
  }
  return s // if we couldn't reach CURRENT_VERSION, the caller discards it
}
```

> **🔧 In Shepherd:** the versioned `migrate()` chain is what lets you evolve the object model without a "delete your config to fix the app" support nightmare. Each release adds one `if (s.version === N)` step. An unknown _future_ version (a downgrade) falls through, fails the equality check, and we start fresh — annoying but safe, never a crash.

### 13.9b Never spawn into a directory that no longer exists

The saved cwd is a _promise about the past_. Between sessions the user may have deleted, moved, or renamed that folder (or it was on an unmounted drive). `spawn`-ing a shell with `cwd` pointing at a missing directory throws (`ENOENT`) and takes down your whole restore. Guard it:

```ts
function safeCwd(saved: string | undefined, fallback: string): string {
  if (saved && existsSync(saved)) return saved
  return existsSync(fallback) ? fallback : homedir() // workspace cwd, then $HOME
}
```

> **⚠️ Gotcha:** this is one of the most common real-world restore failures and it's invisible in testing, because _your_ test folders always exist. Delete a project directory, restart the app, and an unguarded restore either crashes or leaves a blank pane. The `existsSync` ladder — saved dir → workspace dir → home — degrades gracefully instead.

### 13.9c The renderer half: replay _before_ attach

The one ordering rule that matters (step 6). Inside each restored `Terminal` component, write the saved scrollback into xterm **first**, and only _then_ ask main for a live shell. Do it the other way around and live output races the history replay, interleaving garbage.

```tsx
// renderer — inside the Terminal component's mount effect during restore
useEffect(() => {
  const term = new Terminal(/* ... */)
  term.open(containerRef.current!)

  if (restored?.scrollback) term.write(restored.scrollback) // 1) paint history first

  const { cols, rows } = fitAddon.proposeDimensions()!
  window.api.pty.attach({
    // 2) THEN request a live shell
    paneId,
    wsId,
    surfaceId,
    cwd: restored?.cwd,
    cols,
    rows
  })

  const off = window.api.pty.onData(paneId, (d) => term.write(d)) // 3) live output on top
  return () => {
    off()
    term.dispose()
  }
}, [])
```

---

## 13.10 The race you must not lose: restore vs renderer-ready

Beginners write restore as "on app ready, read the file and start sending pty data." It works on their fast dev machine and breaks on a slow one, because of a race:

```
   WRONG (fire-and-hope)                    RIGHT (handshake)
   ─────────────────────                    ─────────────────
   app ready                                app ready → read file
   read file                                createWindow()
   webContents.send(pty-data) ✗             (renderer boots, React mounts...)
        │ renderer isn't listening yet      renderer → 'session:ready'   ← waits for THIS
        ▼                                    main → 'session:restore'(tree)
   data dropped on the floor                 renderer builds tree, mounts xterms
   → blank terminals                         each xterm → 'pty:attach'
                                             main spawns pty → data flows into a ready terminal
```

The renderer is a _web page_: it takes time to boot Chromium, download and execute the bundle, mount React, and construct each xterm.js instance. Anything main sends before that window is _listening_ is dropped — `webContents.send` is fire-and-forget, with no buffering and no delivery guarantee. So you invert control: **the renderer announces readiness, and main responds.** `session:ready` gates the tree; a per-pane `pty:attach` gates each live shell. Nothing is spawned until the exact component that will display it exists and is listening.

> **🔧 In Shepherd:** this is the same "renderer-ready handshake" you'll want for the socket sidebar in Chapter 11 and the notification pipeline in Chapter 12 — any time main has state to push _at startup_, it must wait to be told the renderer is home. Persistence is just the most timing-sensitive case, because there are N terminals each with their own readiness.

---

## 13.11 The UX: "restore previous session?" vs fresh start

You've got the snapshot; now decide how to _offer_ it. Three postures:

1. **Silent auto-restore (cmux-like, recommended default).** Reopen straight into last session, no prompt. It's what makes the app feel like a place you _live_, and it's what cmux does. The safety net is the `.bak` from §13.6 plus an explicit escape hatch to start fresh.
2. **Prompt every launch.** A `dialog.showMessageBox` asking "Restore previous session?" Faithful to some editors, but a papercut you pay on _every_ single launch. Reserve it for _after a crash_, not for the normal path.
3. **A setting.** "On startup: restore last session / start with an empty workspace." The grown-up answer once you have a settings pane (`FEATURES.md` #21), but overkill for v1.

Shepherd currently uses a fourth, deterministic posture: **resume the active
workspace only**. It preserves the last selected layout, cwd, and owned bounded
notification inbox while guaranteeing one workspace at launch. Inactive runtime
workspaces and their notifications are not replayed. The snapshot keeps its array
shape for backward compatibility, and Chapters 12 and 24 cover why save and
restore apply the same projection.

Ship posture #1 with two escape hatches, and you've matched cmux while staying safe:

```ts
// main — an explicit "start fresh" that doesn't destroy the snapshot
const startFresh =
  process.argv.includes('--fresh') || // relaunch flag / power users
  false // (optionally also: a held modifier key at launch, an in-app "New Session" action)

const snapshot = startFresh ? null : loadSnapshot()
// The old session.json is left on disk (renamed to .bak by the next atomic save),
// so "start fresh" is reversible, not a data-loss event.
```

And after a genuine crash, degrade to a _gentle_ prompt rather than silently replaying a session that might have _caused_ the crash:

```ts
if (crashedLastTime()) {
  // e.g. a lockfile you clear on clean quit
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Restore anyway', 'Start fresh'],
    defaultId: 0,
    cancelId: 1,
    message: 'Shepherd didn’t shut down cleanly last time.',
    detail: 'Restore your previous workspace, or start with a clean slate?'
  })
  if (response === 1) return // user chose fresh; leave the snapshot on disk as .bak
}
```

> **⚠️ Gotcha (the restore loop):** if a _corrupt-but-parseable_ snapshot triggers a crash _during restore_, silent auto-restore will faithfully replay it and crash again, forever — an unbootable app. The crash flag + "Start fresh" button above is the circuit breaker. Set the "unclean shutdown" flag _before_ you begin restoring and clear it only after a clean quit; that way a crash mid-restore is detectable on the next launch.

---

## 🧪 Checkpoint

Answer these before moving on (everything is in this chapter):

1. A user had `vim` open editing a file, plus `npm run dev` running, in a pane. They quit and reopen. What comes back, and what doesn't — and _why_ is that not a bug you can fix?
2. Scrollback lives in the renderer, but main writes `session.json`. Describe the mechanism we use to get scrollback into the file, and why we push-on-throttle instead of pull-on-save.
3. Why must you _never_ serialize a pane's `env`? What do you re-inject on restore instead, and where do those values come from?
4. What does `readlinkSync('/proc/<pid>/cwd')` give you, and why is it better than remembering the directory the shell was originally spawned in?
5. Walk the restore sequence. Why must scrollback be replayed into xterm _before_ `pty:attach` is sent? What breaks if you attach first?
6. Give two independent reasons a saved cwd might be invalid on restore, and describe the fallback ladder in `safeCwd`.
7. Your app is stuck in a crash-on-launch loop caused by a bad snapshot. Which two mechanisms from this chapter break the loop?

---

## Summary

Session persistence is a **serialization** problem, not a save-the-processes problem. You walk the Window→Workspace→Pane→Surface→Panel tree (Chapter 09) and write the _serializable_ parts — structure, names, layout sizes, active IDs, and for each terminal its **cwd** (read live from `/proc/<pid>/cwd`) and optional **scrollback** (from `@xterm/addon-serialize`). You **cannot** serialize live pty processes, so on restore you _re-spawn_ fresh shells in the saved directories — you restore the recipe, not the process. Scrollback lives in the renderer, so main caches it via a throttled push and writes it synchronously. You store the snapshot in `app.getPath('userData')` (`~/.config/shepherd/`), **versioned** and written **atomically** (temp-then-rename) with a `.bak` fallback and `0600` permissions, and you **never** persist the environment (secrets). You save **debounced on change** and again **synchronously on `before-quit`**. Restore is a **handshake**: main reads and migrates the file, waits for `session:ready`, sends the tree, and only spawns each shell when its pane says `pty:attach` — replaying scrollback _before_ attaching live output. Every failure mode — corrupt file, old schema, missing directory, unclean shutdown — degrades gracefully to a clean start instead of a crash.

The current product projects this general recipe to the active workspace and its
validated inbox so startup cardinality is exactly one; see Chapters 12 and 24.

## Where this shows up next

- The object model you serialized, in full → `09-typescript-and-the-data-model.md`
- The split-tree `sizes` you saved, and how they rebuild the layout → `10-tiling-and-layout.md`
- Re-spawning shells in saved cwds → `06-node-pty.md`; replaying scrollback into terminals → `07-xtermjs.md`
- The IPC handshake pattern (`session:ready`, `pty:attach`) → `04-ipc-inter-process-communication.md`
- Why main is the source of truth you serialize from → `11-the-socket-api.md`
- Where `~/.config/shepherd/` and the read-only AppImage caveat come from → `15-packaging-and-distribution.md`
- The end-to-end trace that ties save/restore into the whole app → `17-how-it-all-connects.md`
- The active-only startup policy and backward-compatible projection → `24-single-workspace-startup.md`

## Further reading

- Electron `app.getPath` (the `userData` directory) — https://www.electronjs.org/docs/latest/api/app#appgetpathname
- xterm.js serialize addon — https://github.com/xtermjs/xterm.js/tree/master/addons/addon-serialize
- Atomic file writes on Linux (`rename(2)` semantics) — https://man7.org/linux/man-pages/man2/rename.2.html
- The Linux `/proc/<pid>/cwd` symlink — https://man7.org/linux/man-pages/man5/proc.5.html
- Our own `FEATURES.md` (#11 session restoration) and `ROADMAP.md` (M4)
