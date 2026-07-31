# Chapter 6 — node-pty: Running Real Shells

> **What you'll learn**
>
> - What a PTY is, recapped fast from Chapter 2, and why every real shell needs one
> - `node-pty`: a Node binding that spawns a process wired to a pseudo-terminal
> - `pty.spawn(shell, args, opts)` with **every** option explained
> - Reading output (`onData`), writing input (`write`), resizing (`resize`)
> - Why resize matters: `SIGWINCH` is how `vim`/`htop`/`less` learn their new size
> - Exit handling (`onExit`, `kill`) and how to **not** leak zombie shells
> - Why node-pty is a **native C++ module** that must run in the **main** process
> - Managing many terminals with a `Map<ptyId, IPty>` and cleaning them up
> - Injecting `SHEPHERD_WORKSPACE_ID` / `SHEPHERD_SURFACE_ID` / `SHEPHERD_SOCKET_PATH` into each pane
> - A full worked example: the **backend half of Loops A & B**
>
> **Prerequisites:** Chapter 2 (`02-how-terminals-work.md`) for TTY/PTY and escape
> codes; Chapter 3 (`03-electron-architecture.md`) for the main-vs-renderer split.
> This chapter lives entirely in the **main process** — the Node backend.

---

## 6.1 Sixty-second recap: what a PTY actually is

Chapter 2 established the physics; here's just enough to stand on.

A program like `bash` doesn't know how to draw itself on a screen. It only knows
how to read bytes from its **standard input** and write bytes to its **standard
output**. When you run bash in a real terminal window, those two streams are
connected to a **terminal device** — historically a `/dev/tty*` file provided by
the OS. That device does three jobs bash can't do for itself:

1. It carries the bytes both directions (your keystrokes in, its output out).
2. It reports a **size** (columns × rows) so bash can lay text out.
3. It supports **control operations** — line editing, `Ctrl-C` turning into a
   signal, echo on/off — the stuff that makes a terminal feel like a terminal.

A **pseudo-terminal (PTY)** is a software fake of that hardware device, created
in pairs:

```
        ┌──────────────┐                         ┌──────────────┐
        │   PTY MASTER │  ── the kernel wires ──► │  PTY SLAVE   │
        │  (you hold   │      these two ends      │  (bash's     │
        │   this end)  │  ◄── together for you ── │   stdin/out) │
        └──────┬───────┘                         └──────┬───────┘
               │                                        │
      you write keystrokes here            bash reads them as stdin here
      you read bash's output here          bash writes its output here
```

Whoever holds the **master** end is, as far as bash can tell, "the terminal."
Bash gets the **slave** end wired to its stdin/stdout/stderr and is none the
wiser — it thinks it's talking to a real screen and keyboard. It will happily
emit the color codes, cursor moves, and screen-clears from Chapter 2, because a
PTY reports itself as a genuine terminal.

> **🔧 In Shepherd:** our whole terminal experience is "hold the master end of a
> PTY in the main process, and shuttle its bytes to a picture of a terminal in the
> renderer." node-pty is the thing that creates the PTY pair and hands us the
> master end. The **picture** — drawing those bytes — is `xterm.js`, and it's the
> entire subject of the next chapter, `07-xtermjs.md`.

The one thing to hold onto: **the master end is just two byte streams plus a
size and some controls.** Everything in this chapter is a method for working one
of those: read the output stream, write the input stream, change the size, or
tear the whole thing down.

---

## 6.2 What node-pty is (and what it is _not_)

Creating a PTY pair and launching a process attached to the slave end is a dance
of low-level OS calls — `openpty`, `fork`, `setsid`, `ioctl`, `execvp` on Linux
(and an entirely different mechanism, ConPTY, on Windows). You do **not** want to
write that by hand, and you can't do it in pure JavaScript anyway — Node's
standard library doesn't expose those calls.

**node-pty** is a small library, maintained by the VS Code team at Microsoft,
that wraps all of it. You hand it a shell to run; it does the OS dance and hands
you back a tidy JavaScript object representing the master end:

```ts
import * as pty from 'node-pty'

const shell = pty.spawn('bash', [], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: process.env.HOME,
  env: process.env
})

shell.onData((chunk) => process.stdout.write(chunk)) // bash's output
shell.write('ls\r') // type "ls" + Enter
```

Run that in a plain Node script and you'll see a real `ls` listing print out.
There is an actual `bash` process in your OS process table with its own PID; you
are driving it through a real pseudo-terminal.

> **⚠️ Gotcha — node-pty is not `child_process`.** Node's built-in
> `child_process.spawn` also launches programs, and you may reach for it out of
> habit. It gives the child a plain **pipe** for stdout, _not_ a terminal. A pipe
> is not a TTY, so the child's `isatty()` check returns false. Interactive shells
> then disable their prompt, colors, and line editing ("am I being piped into a
> file? I'll behave like a dumb filter"), and full-screen apps like `vim` refuse
> to start at all. node-pty exists precisely to give the child a **real
> terminal** so it behaves the way it does in your normal terminal window. Use
> `child_process` for one-shot commands whose output you just want to capture
> (e.g. `git branch --show-current` — see `REFRESHER.md`); use node-pty for
> anything a human is supposed to interact with.

| Tool                  | What the child's stdin/stdout is | Good for                                  |
| --------------------- | -------------------------------- | ----------------------------------------- |
| `child_process.spawn` | a pipe (not a TTY)               | run a command, capture output, exit       |
| **node-pty**          | a real PTY (a TTY)               | interactive shells, agents, `vim`, `htop` |

---

## 6.3 `pty.spawn(shell, args, options)` — every option explained

This one call is the heart of the chapter. Its shape:

```ts
const ptyProcess = pty.spawn(file, args, options)
```

- **`file`** — the program to run. For us, a shell: `'bash'`, `'zsh'`, or better,
  the user's configured shell `process.env.SHELL ?? 'bash'`. It can be any
  executable, though — `pty.spawn('htop', [], opts)` runs htop directly in the
  PTY.
- **`args`** — an array of command-line arguments passed to `file`. For a bare
  interactive shell this is usually `[]`. If you wanted a login shell you might
  pass `['-l']`; to run a single command and exit, `['-c', 'npm test']`.
- **`options`** — the interesting part. Here is the full set that matters to us:

```ts
const ptyProcess = pty.spawn(process.env.SHELL ?? 'bash', [], {
  name: 'xterm-256color', // (1) the value of $TERM inside the shell
  cols: 80, // (2) initial width  in character columns
  rows: 24, // (3) initial height in character rows
  cwd: workspace.cwd, // (4) starting working directory
  env: { ...process.env }, // (5) the environment variables
  encoding: 'utf8' // (6) how onData decodes bytes → strings
})
```

**(1) `name` — what `$TERM` is set to.** Inside the shell, programs read the
`TERM` environment variable to decide _which_ escape codes are safe to emit. A
program seeing `TERM=xterm-256color` knows it may use the full 256-color palette
(and usually 24-bit "truecolor") from Chapter 2; a program seeing a bare
`TERM=dumb` will avoid colors entirely. node-pty defaults this to a conservative
value, so we set it explicitly. **Pass `'xterm-256color'`** — it must name a
terminal type that our renderer (xterm.js) can actually draw, and xterm.js
understands the xterm family.

> **⚠️ Gotcha:** `name` is _not_ cosmetic. If you leave `$TERM` at something
> primitive, agents and tools will print washed-out, colorless output and you'll
> wonder why cmux "looks broken" compared to your normal terminal. The colors you
> see are a negotiation, and `name` is your opening offer.

**(2)/(3) `cols` and `rows` — the initial size.** The PTY has to report _some_
size the instant bash starts, before the UI has even measured itself. 80×24 is
the ancient, safe default (it's the size of a VT100 screen). We'll immediately
correct it once the real terminal has laid out and measured its container —
that's the "resize dance" in §6.6.

**(4) `cwd` — the starting directory.** Where the shell begins, exactly like the
directory your terminal opens in. For us this is the workspace's directory so
that `ls`, `git status`, and an agent all operate on the right project.

> **⚠️ Gotcha — a bad `cwd` throws.** If `cwd` points at a directory that doesn't
> exist, `pty.spawn` throws synchronously and takes down whatever called it.
> Always pass a directory you know exists — validate it, or fall back to
> `os.homedir()`. When we restore a saved session (`13-session-persistence.md`),
> a workspace's saved directory might have been deleted since last launch; guard
> for it.

**(5) `env` — the environment.** A plain object of `KEY: value` strings that
becomes the shell's environment. This is enormously important and has one classic
trap:

> **⚠️ Gotcha — never pass a bare `{ ... }` as `env`.** Whatever object you pass
> _replaces_ the environment entirely; it is not merged. If you write
> `env: { SHEPHERD_WORKSPACE_ID: id }`, the shell launches with **only** that one
> variable — no `PATH`, no `HOME`, no `LANG`. `PATH` being gone means the shell
> can't find `ls`, `git`, or anything else, and the pane looks broken. **Always
> spread `process.env` first:** `env: { ...process.env, SHEPHERD_WORKSPACE_ID: id }`.
> §6.8 builds exactly this for our three `SHEPHERD_*` variables.

**(6) `encoding` — bytes to strings.** node-pty reads raw bytes off the PTY.
With `encoding: 'utf8'` (the default) it decodes them into JavaScript strings for
you before handing them to `onData`, and — crucially — it buffers correctly so a
multi-byte UTF-8 character (an emoji, a box-drawing glyph) is never split across
two `onData` events. If you instead pass `encoding: null` you get raw `Buffer`
chunks and must handle byte-splitting yourself. We keep the default `'utf8'`; it's
the least surprising choice, and strings pipe straight into xterm.js.

There are a few more advanced options — `handleFlowControl`, `flowControlPause`,
`flowControlResume` (XON/XOFF back-pressure for programs that dump gigabytes),
and Windows-only ConPTY toggles. We target Linux and won't stream firehoses per
pane, so the defaults are fine. Know they exist; don't touch them yet.

### The object you get back: `IPty`

`pty.spawn` returns an object typed `IPty`. These are the members you'll actually
use:

| Member                 | Kind     | What it does                                    |
| ---------------------- | -------- | ----------------------------------------------- |
| `pid`                  | property | the OS process id of the spawned shell          |
| `cols`, `rows`         | property | its current size (updated by `resize`)          |
| `process`              | property | the shell's current foreground process name     |
| `onData(cb)`           | event    | fires with each chunk of **output** (§6.4)      |
| `onExit(cb)`           | event    | fires once, when the shell **exits** (§6.7)     |
| `write(data)`          | method   | send **input** (keystrokes) to the shell (§6.5) |
| `resize(cols, rows)`   | method   | change the terminal size (§6.6)                 |
| `kill(signal?)`        | method   | terminate the shell (§6.7)                      |
| `pause()` / `resume()` | method   | pause/resume the output stream (back-pressure)  |

The two events (`onData`, `onExit`) are how the shell talks **to** us; the two
methods (`write`, `resize`) plus `kill` are how we talk **to** it. That's the
whole interface. Let's take them one at a time.

---

## 6.4 Reading output: `onData`

Whenever the shell produces output — a command's result, the prompt, a color
code, a full-screen redraw — node-pty fires `onData` with that chunk as a string:

```ts
const disposable = ptyProcess.onData((chunk: string) => {
  // `chunk` is a piece of the shell's raw output stream, escape codes and all.
  // It is NOT line-buffered: you might get "ls\r\n", or "l", "s", "\r\n",
  // or a 4KB blob — whatever the OS handed over this tick.
  console.log(JSON.stringify(chunk))
})
```

Three things to internalize about this stream:

1. **It's raw terminal bytes, not clean text.** A chunk can contain escape
   sequences like `\x1b[32m` (green on) or `\x1b[2J` (clear screen). You do **not**
   parse or clean these — you forward them verbatim to xterm.js, whose entire job
   is to interpret them (Chapter 7). Stripping them would throw away all the
   colors and cursor motion.
2. **Chunk boundaries are meaningless.** Never assume a chunk is a line, a
   command, or a complete escape sequence. A single escape code can be split
   across two chunks. Consumers must be tolerant — and both of ours (xterm.js and
   the OSC parser) are, because they're incremental state machines.
3. **`onData` returns a disposable.** The return value has a `.dispose()` method
   that unsubscribes this one listener. You'll call it during cleanup so you don't
   leak listeners when a pane closes.

> **🔧 In Shepherd:** `onData` is the source end of **Loop B** ("the shell
> prints output") from Chapter 1. In the full example (§6.9) we do two things with
> every chunk: (a) forward it to the renderer with `webContents.send('pty:data',
…)` so xterm.js can paint it, and (b) let the **OSC parser** peek at it to catch
> notification escape codes. That second consumer is why the main process reads
> the stream at all instead of piping the PTY straight to the window — it's the
> hook for `12-notifications-and-osc.md`.

There is now a third bounded consumer in `src/main/terminalInspection.ts`. It
copies each chunk into a per-terminal 256 KiB byte ring for explicit
`inspect-agent` queries. This does **not** replace or modify the stream sent to
xterm.js. On spawn, resize, exit, and dispose, the PTY manager registers, updates,
or removes the matching capture so inspection cannot outlive the terminal.

The ring re-encodes node-pty's raw stream chunks as UTF-8 bytes; escape sequences
can still cross `onData` boundaries. Plain-text cleanup and the caller's line/byte
tail limits are applied only when a query arrives. This keeps normal terminal
rendering fast and ensures every socket reply is bounded even though the terminal
may run for days.

---

## 6.5 Writing input: `write`

Input flows the other way. When the user types, you send those bytes into the
shell with `write`:

```ts
ptyProcess.write('l') // the user pressed the "l" key
ptyProcess.write('s') // then "s"
ptyProcess.write('\r') // then Enter — carriage return runs the command
```

Some subtleties that trip people up:

- **You send keystrokes, not commands.** There is no "run this command" call.
  You feed the shell the exact bytes a keyboard would produce, one keystroke at a
  time, and the shell's own line editor assembles them into a command line. To
  "run `ls`," you write the characters `l`, `s`, and then `\r` (Enter). This is
  liberating: it means _every_ key works — arrows, `Ctrl-C`, `Tab` completion,
  history — because you're just relaying the raw keyboard.
- **Enter is `\r` (carriage return, `0x0D`), not `\n`.** A real terminal sends
  `\r` when you press Return; the terminal line discipline is what turns that into
  a newline. Send `\n` and some programs won't treat it as "submit."
- **Control keys are control bytes.** `Ctrl-C` is the single byte `\x03`,
  `Ctrl-D` is `\x04`, `Tab` is `\t` (`0x09`), Escape is `\x1b`. Arrow keys are
  multi-byte escape sequences (Up is `\x1b[A`). You don't usually hand-encode
  these — xterm.js does it for you (Chapter 7) and you forward whatever it gives
  you — but it's good to know that `write` is byte-for-byte the keyboard.

> **🔧 In Shepherd:** `write` is the destination end of **Loop A** ("you type a
> command"). xterm.js's `onData` (confusingly named the same, but it's the
> _renderer's_ keystroke event) fires with the encoded bytes for whatever you
> pressed; we ship those over IPC; the main process calls `ptyProcess.write` with
> them. Renderer keystroke → IPC → `pty.write`. That's the entire input path.

---

## 6.6 Resizing: `resize(cols, rows)` and why it matters

A terminal has a size measured in **character cells** — columns and rows — and
programs running inside it _depend_ on that size to lay themselves out. When the
window resizes, or the user drags a split divider, or the sidebar collapses, the
terminal's pixel dimensions change, which means a different number of character
cells now fit. You must tell node-pty:

```ts
ptyProcess.resize(120, 40) // now 120 columns wide, 40 rows tall
```

Here's the machinery this kicks off, and why skipping it produces garbage:

```
UI container changes size (window resize / split drag / sidebar toggle)
        │
        ▼
xterm.js measures its box → "I now fit 120×40 cells" (FitAddon, ch 07)
        │  send {cols:120, rows:40} over IPC to main
        ▼
ptyProcess.resize(120, 40)
        │  node-pty performs the TIOCSWINSZ ioctl on the PTY master
        ▼
the kernel records the new window size AND delivers SIGWINCH
        │  ("window changed" signal) to the shell's foreground process
        ▼
vim / htop / less catch SIGWINCH, re-read the size, and REDRAW at 120×40
```

The load-bearing concept is **`SIGWINCH`** — the "window change" signal. A
full-screen program (an editor, a pager, a TUI) draws itself _once_ to fill the
size it thinks it has, then only redraws when something changes. It finds out the
size changed exactly one way: the kernel sends it `SIGWINCH`, and it responds by
asking the terminal for the new dimensions and repainting. `ptyProcess.resize` is
what makes the kernel send that signal.

> **⚠️ Gotcha — forget resize and full-screen apps go haywire.** If the UI grows
> but you never call `resize`, the shell still believes it's 80×24. `vim` keeps
> drawing an 80×24 editor into a 120×40 space: lines wrap in the wrong places, the
> status bar lands mid-screen, the cursor sits nowhere near where you're typing,
> and clearing the screen leaves debris. Users describe it as "the terminal is
> corrupted." It isn't — the two ends simply disagree about the size. Every UI
> size change **must** end in a `ptyProcess.resize` call. This is one of the most
> common bugs when wiring a terminal for the first time.

> **🔧 In Shepherd:** the renderer owns the _measuring_ (xterm's FitAddon turns
> the container's pixel size into cols/rows — see `07-xtermjs.md`), and the main
> process owns the _applying_ (`ptyProcess.resize`). They're joined by an IPC
> message carrying `{ paneId, cols, rows }`. Keep that division clear: renderer
> measures, main applies.

---

## 6.7 Exit and cleanup: `onExit`, `kill`, and the zombie problem

A shell ends in one of two ways, and you handle both.

**It exits on its own.** The user types `exit`, or presses `Ctrl-D`, or the
program you spawned finishes. `onExit` fires once:

```ts
ptyProcess.onExit(({ exitCode, signal }) => {
  // exitCode: 0 = clean; nonzero = error. signal: set if killed by a signal.
  console.log(`shell exited: code=${exitCode} signal=${signal}`)
  // → tell the renderer the pane's shell is gone, remove it from our Map, etc.
})
```

**You kill it.** When the user closes a pane, closes the window, or quits the
app, _you_ end the shell:

```ts
ptyProcess.kill() // terminate the shell (POSIX: a hang-up, like
// closing a real terminal window)
ptyProcess.kill('SIGKILL') // or force it, if it won't go quietly
```

Now the important part — **the zombie problem** — because getting this wrong is
the single most common resource leak in a multi-terminal app.

Every `pty.spawn` creates a **real OS process** that keeps running until
something stops it. If a pane is closed (its React component unmounts, its
xterm.js instance is disposed) but you **forget to call `kill`**, that shell
keeps running headless, forever, holding memory and file descriptors. Do that a
few dozen times across a work session and you've got a pile of orphaned `bash`
processes eating RAM, plus any agents _they_ spawned still churning in the
background.

```
Close a pane WITHOUT killing its pty:
   pane UI gone ✅   xterm.js disposed ✅   bash process ???  ← still alive, leaked
                                                             ← its child agent ??? ← also alive

Close a pane WITH kill() + Map cleanup:
   pane UI gone ✅   xterm.js disposed ✅   bash process reaped ✅   Map entry deleted ✅
```

> **⚠️ Gotcha — "zombie" precisely.** Two distinct failures hide under that word.
> (1) A **leaked/orphaned** process: a shell you never killed, still running —
> this is the common one, caused by forgetting `kill()`. (2) A true **zombie
> (defunct)** process: one that _has_ exited but whose parent never read its exit
> status, so the kernel keeps a husk in the process table. node-pty reaps its own
> children when they exit (that's part of what fires `onExit`), so as long as you
> (a) `kill()` shells you no longer want and (b) let `onExit` clean up your
> bookkeeping, you avoid both. The rule of thumb: **every `spawn` must be paired
> with a guaranteed `kill` on the teardown path.** §6.8 makes that guarantee
> structural.

---

## 6.8 node-pty is a **native module** (and what that forces)

Here is a fact that shapes _where_ all of the above must live: **node-pty is a
native module.** It's not pure JavaScript — a chunk of it is C++ that gets
compiled into a binary (`.node` file) when you install it, because talking to the
OS's PTY layer requires calling C functions JavaScript can't reach.

Three consequences follow, and each is a gotcha someone hits:

**1. It must be rebuilt for Electron's ABI.** A native module is compiled against
a specific version of Node's C++ interface (its "ABI"). Electron ships its _own_
build of Node, often a different version than the one on your `PATH`. So a
node-pty compiled by plain `npm install` may refuse to load inside Electron with
an error like _"was compiled against a different Node.js version"_ or _"invalid
ELF header."_ The fix is to recompile it against Electron's ABI:

```bash
# recompile native modules (node-pty) for the Electron version in this project
npx electron-rebuild        # the @electron/rebuild tool
# electron-builder does this for you at package time via install-app-deps
```

> **🔧 In Shepherd:** we'll wire `electron-rebuild` into a `postinstall`
> script so this happens automatically, and let `electron-builder` handle it at
> packaging time (`15-packaging-and-distribution.md`). If terminals mysteriously
> fail to open right after an `npm install` or an Electron version bump, this is
> almost always the cause — rebuild and it comes back to life.

**2. It can only run in the main process.** The **renderer** is a sandboxed
Chromium page (`contextIsolation: true`, `nodeIntegration: false` — see
`05-preload-and-context-isolation.md`); it has no access to native Node modules
and shouldn't. node-pty therefore lives **only** in the main process. The
renderer never imports it. It reaches the shell exclusively through the IPC
bridge — which is exactly why the architecture funnels every keystroke through
preload and IPC in the first place.

> **⚠️ Gotcha:** if you ever see `import * as pty from 'node-pty'` in a file
> under `renderer/`, that's a bug. It will fail to bundle or fail at runtime.
> node-pty belongs in `main/` — full stop.

**3. It ships as a real dependency.** Because it's needed at runtime (not just at
build time), node-pty is a `dependencies` entry, not `devDependencies`, and its
compiled binary must be included in the packaged app.

```
         RENDERER (sandboxed Chromium)        MAIN (full Node + native modules)
         ─────────────────────────────        ─────────────────────────────────
         React, xterm.js                       node-pty (C++ .node binary) ✅
         ❌ cannot load node-pty        IPC     spawns real bash/zsh
         talks to the shell ONLY  ◄──────────► holds every PTY master end
         through window.api + IPC
```

---

## 6.9 Managing MANY ptys: a `Map<ptyId, IPty>`

One terminal is easy — hold it in a variable. But Shepherd has _many_
terminals: every Surface with a Terminal panel owns its own shell (recall the
object model, `09-typescript-and-the-data-model.md`). We need to route each
chunk of output to the _right_ pane and, later, route each keystroke to the
_right_ shell. The clean way is a registry keyed by a pane/pty id:

```ts
// main/pty-manager.ts  — the main process's terminal registry
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { WebContents } from 'electron'

const ptys = new Map<string, IPty>() // ptyId → the live shell

export function createPty(
  ptyId: string,
  opts: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv },
  webContents: WebContents
): void {
  const shell = pty.spawn(process.env.SHELL ?? 'bash', [], {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: opts.env
  })

  ptys.set(ptyId, shell)

  // OUTPUT: forward every chunk to the renderer, tagged with which pane it's for.
  shell.onData((data) => {
    webContents.send('pty:data', { ptyId, data })
    // (the OSC parser from ch 12 also gets a look at `data` here)
  })

  // EXIT: tell the UI, then clean up our bookkeeping so nothing leaks.
  shell.onExit(({ exitCode }) => {
    webContents.send('pty:exit', { ptyId, exitCode })
    ptys.delete(ptyId)
  })
}

export function writeToPty(ptyId: string, data: string): void {
  ptys.get(ptyId)?.write(data) // ?. → ignore input to a dead pane
}

export function resizePty(ptyId: string, cols: number, rows: number): void {
  ptys.get(ptyId)?.resize(cols, rows)
}

export function killPty(ptyId: string): void {
  const shell = ptys.get(ptyId)
  if (!shell) return
  shell.kill()
  ptys.delete(ptyId)
}

export function killAllPtys(): void {
  for (const shell of ptys.values()) shell.kill()
  ptys.clear()
}
```

Walking through the design choices:

- **`ptys.get(ptyId)?.write(...)`** — the optional-chaining `?.` matters. A
  keystroke or resize can arrive a beat after a shell exited (IPC is async).
  Looking up a deleted id returns `undefined`; `?.` makes the call a harmless
  no-op instead of a crash.
- **`onExit` deletes from the Map.** When a shell dies on its own, its entry
  cleans itself up. Combined with `killPty` (which also deletes), the Map never
  accumulates dead entries — no leak, whichever way a shell ends.
- **`killAllPtys` is the safety net.** Wire it to the app's shutdown so no shell
  outlives the app:

```ts
import { app } from 'electron'
app.on('before-quit', killAllPtys) // quitting the app
// and when a pane closes, call killPty(ptyId) from that pane's teardown
```

> **🔧 In Shepherd:** this `Map<ptyId, IPty>` is the main-process mirror of the
> renderer's tree of terminal components. For every Terminal panel the UI shows,
> there's exactly one entry here holding its real shell. When a pane closes, two
> things must happen in lockstep: the renderer disposes the xterm.js instance
> (`07-xtermjs.md`) **and** the main process `killPty`s the shell. Miss the second
> and you've got the §6.7 zombie. Wiring both onto the same "close pane" action is
> how we keep them honest.

---

## 6.10 Env injection: making in-pane commands find cmux

Recall from `FEATURES.md` that the sidebar comes alive because agents _send
messages to a unix socket_. But an agent — say Claude Code — running **inside** a
pane needs to know two things to do that: **which socket** to talk to, and **which
workspace** it belongs to. We tell it by injecting three environment variables
into that pane's shell at spawn time:

```ts
const paneEnv = {
  ...process.env, // ← keep PATH, HOME, LANG, …
  SHEPHERD_WORKSPACE_ID: workspace.id, // which sidebar row this pane is under
  SHEPHERD_SURFACE_ID: surface.id, // which tab within the pane
  SHEPHERD_SOCKET_PATH: '/tmp/shepherd.sock' // where our socket server listens
}

createPty(ptyId, { cwd: workspace.cwd, cols, rows, env: paneEnv }, webContents)
```

Now any command run in that pane inherits those variables. So when Claude Code
finishes and its hook runs `shepherd notify --body "waiting for input"`, the `shepherd`
CLI reads `SHEPHERD_SOCKET_PATH` to find the socket and `SHEPHERD_WORKSPACE_ID` to stamp
the message with the right workspace — **no arguments needed**, because the pane's
environment already carries its identity.

| Variable                | Answers the question              | Consumed by                                                        |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `SHEPHERD_WORKSPACE_ID` | "which sidebar row am I?"         | the `shepherd` CLI → socket server → the right workspace lights up |
| `SHEPHERD_SURFACE_ID`   | "which tab within the pane am I?" | targeting a specific surface for input/focus                       |
| `SHEPHERD_SOCKET_PATH`  | "where do I send messages?"       | the `shepherd` CLI, to connect to the server                       |

```
   main process spawns pane's shell with env:
   { …process.env, SHEPHERD_WORKSPACE_ID, SHEPHERD_SURFACE_ID, SHEPHERD_SOCKET_PATH }
        │
        ▼
   inside the pane, an agent finishes and runs:  shepherd notify --body "waiting"
        │  the CLI reads SHEPHERD_SOCKET_PATH + SHEPHERD_WORKSPACE_ID from its env
        ▼
   connects to /tmp/shepherd.sock, sends a JSON message tagged with the workspace
        │
        ▼
   main updates that workspace → IPC → renderer lights up the sidebar row  🔔
```

This is the seam between "a real shell in a pane" (this chapter) and "the socket
API that drives the sidebar" (`11-the-socket-api.md`) and "notifications"
(`12-notifications-and-osc.md`). node-pty is what stamps each pane with its
identity so the rest of the system can find it.

> **⚠️ Gotcha (worth repeating):** the injection only works because of the
> `...process.env` spread. Injecting _just_ the three `SHEPHERD_*` vars would strip
> `PATH` and the pane couldn't even find the `shepherd` binary to call. Merge, never
> replace.

---

## 6.11 The full worked example: the backend half of Loops A & B

Let's assemble everything into the complete main-process side of the terminal
loop. Pair this with the preload/IPC wiring from
`04-ipc-inter-process-communication.md` and `05-preload-and-context-isolation.md`,
and with the renderer side in `07-xtermjs.md`.

```ts
// main/index.ts (excerpt) — the backend half of the terminal
import { app, BrowserWindow, ipcMain } from 'electron'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import os from 'node:os'

const ptys = new Map<string, IPty>()

function createWindow() {
  const win = new BrowserWindow({
    webPreferences: {
      preload: /* path to preload.js */ '',
      contextIsolation: true, // renderer stays sandboxed
      nodeIntegration: false // renderer cannot touch node-pty directly
    }
  })

  // ── LOOP A (input): renderer keystroke → main → pty.write ──────────────
  ipcMain.on('pty:input', (_event, { ptyId, data }) => {
    ptys.get(ptyId)?.write(data)
  })

  // ── resize: renderer measured a new size → main → pty.resize ───────────
  ipcMain.on('pty:resize', (_event, { ptyId, cols, rows }) => {
    ptys.get(ptyId)?.resize(cols, rows)
  })

  // ── spawn a terminal for a pane ────────────────────────────────────────
  ipcMain.handle('pty:create', (_event, { ptyId, cwd, cols, rows, workspaceId, surfaceId }) => {
    const shell = pty.spawn(process.env.SHELL ?? 'bash', [], {
      name: 'xterm-256color',
      cols: cols ?? 80,
      rows: rows ?? 24,
      cwd: cwd ?? os.homedir(), // guard against a missing dir
      env: {
        ...process.env, // keep PATH/HOME/LANG
        SHEPHERD_WORKSPACE_ID: workspaceId,
        SHEPHERD_SURFACE_ID: surfaceId,
        SHEPHERD_SOCKET_PATH: '/tmp/shepherd.sock'
      }
    })

    ptys.set(ptyId, shell)

    // ── LOOP B (output): pty.onData → main → renderer paints it ──────────
    shell.onData((data) => {
      win.webContents.send('pty:data', { ptyId, data })
      // NOTE: this same `data` is where ch 12's OSC parser watches for
      // notification escape codes (OSC 9 / 99 / 777) before/while forwarding.
    })

    // ── exit: tell the UI, drop the bookkeeping (no zombie) ──────────────
    shell.onExit(({ exitCode }) => {
      win.webContents.send('pty:exit', { ptyId, exitCode })
      ptys.delete(ptyId)
    })

    return { ptyId, pid: shell.pid }
  })

  // ── close a single pane's shell ──────────────────────────────────────
  ipcMain.on('pty:kill', (_event, { ptyId }) => {
    ptys.get(ptyId)?.kill()
    ptys.delete(ptyId)
  })

  win.loadURL(/* renderer URL */ '')
}

app.whenReady().then(createWindow)

// ── safety net: never let a shell outlive the app ──────────────────────
app.on('before-quit', () => {
  for (const shell of ptys.values()) shell.kill()
  ptys.clear()
})
```

Trace the two loops through this code so the shape is unmistakable:

**Loop A — you type `l` in a pane:**

1. xterm.js (renderer) encodes the keystroke and calls
   `window.api.sendInput(ptyId, 'l')` (preload).
2. That's an IPC message on `'pty:input'`; `ipcMain.on('pty:input', …)` receives
   it here.
3. `ptys.get(ptyId)?.write('l')` sends the byte into the real bash.

**Loop B — bash echoes and later prints output:**

1. bash writes to its PTY; node-pty fires `shell.onData(data)` in the main
   process.
2. `win.webContents.send('pty:data', { ptyId, data })` pushes the chunk to the
   renderer over IPC.
3. The renderer's `window.api.onPtyData(...)` handler calls `term.write(data)` and
   xterm.js paints it (Chapter 7).

That round-trip — keystroke down, output up — is the beating heart of the app,
and this file is its backend half. Everything else Shepherd does (splits, the
sidebar, notifications, persistence) is built _around_ this loop, not instead of
it.

> **🔧 In Shepherd:** notice how little is here. The "hard" terminal work is
> node-pty's; our main-process job is just **routing** — spawn on request, forward
> output out, forward input/resize in, and kill on the way out. Keep this file
> boring and mechanical; the interesting product logic lives in the sidebar and
> socket layers (`11-the-socket-api.md`).

---

## 🧪 Checkpoint

Answer these before moving on (all answers are in this chapter):

1. What does node-pty give a child process that `child_process.spawn` does not,
   and why does that difference make `vim` work in one and not the other?
2. In `pty.spawn(shell, args, opts)`, what does the `name` option actually
   control, and what breaks if you leave it too primitive?
3. Why must you write `env: { ...process.env, SHEPHERD_WORKSPACE_ID: id }` instead of
   `env: { SHEPHERD_WORKSPACE_ID: id }`? What concretely breaks otherwise?
4. Explain the chain from "user drags a split divider" to "`vim` redraws at the
   new size." Which signal is the linchpin, and which call triggers it?
5. Give two distinct meanings of "zombie" here and the single rule that prevents
   both.
6. Why can node-pty run only in the main process, and what tool do you run when it
   fails to load after an Electron upgrade?
7. In the §6.11 example, which line is the source of Loop B and which is the
   destination of Loop A?

---

## Summary

**node-pty** creates a pseudo-terminal and spawns a **real shell** attached to
it, handing you the master end as an `IPty` object. You **read** the shell's
output with `onData`, **write** keystrokes with `write`, keep the size honest
with `resize` (which triggers `SIGWINCH` so full-screen apps redraw), and **tear
down** with `kill` while watching `onExit`. Because it's a **native C++ module**,
it must be rebuilt for Electron's ABI and can run **only in the main process** —
the renderer reaches it exclusively over IPC. Shepherd holds every shell in a
`Map<ptyId, IPty>`, cleans each up on pane close and app quit to avoid **zombie**
processes, and injects `SHEPHERD_WORKSPACE_ID` / `SHEPHERD_SURFACE_ID` /
`SHEPHERD_SOCKET_PATH` into each pane so in-pane agents can find the socket. All told,
node-pty is the **backend half of Loops A & B** and the stream the OSC parser
listens on — the "real shell" end of the wire whose other end is xterm.js.

## Where this shows up next

- The **picture** of the shell that consumes `onData` and produces the keystrokes we `write` → `07-xtermjs.md`
- Mounting that picture in React, and disposing it in lockstep with `killPty` → `08-react-in-this-app.md`
- The `ptyId` / Workspace / Surface identities the Map is keyed on → `09-typescript-and-the-data-model.md`
- What the injected `SHEPHERD_SOCKET_PATH` connects to → `11-the-socket-api.md`
- The OSC codes the main process scans `onData` for → `12-notifications-and-osc.md`
- Re-spawning saved shells in saved `cwd`s on relaunch → `13-session-persistence.md`
- Rebuilding the native module for a shipped app → `15-packaging-and-distribution.md`
- The full keystroke trace, end to end → `17-how-it-all-connects.md`

## Further reading

- node-pty (README + the TypeScript declaration file, the authoritative API): https://github.com/microsoft/node-pty
- Electron — Using Native Node Modules: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- @electron/rebuild (recompile native modules for Electron's ABI): https://github.com/electron/rebuild
- `TIOCSWINSZ` and terminal window size (the ioctl behind `resize`): https://man7.org/linux/man-pages/man4/tty_ioctl.4.html
- `SIGWINCH` and signals overview: https://man7.org/linux/man-pages/man7/signal.7.html
- How pseudoterminals work (`pty(7)`): https://man7.org/linux/man-pages/man7/pty.7.html
