# Chapter 1 — The Big Picture

> **What you'll learn**
>
> - What problem motivated Shepherd and why it exists on Linux
> - The complete architecture of Shepherd on a single mental canvas
> - The four technologies in our stack and the exact job each one does
> - The "core loop" that every later chapter is secretly explaining
> - How the build milestones map onto the architecture
>
> **Prerequisites:** none. This is the foundation. Read it before anything else.

---

## 1.1 The problem: too many agents, not enough eyes

Modern AI coding agents (Claude Code, Codex, Gemini CLI, Aider, and friends) run
_in a terminal_. They're powerful, but they have an awkward property: **they work
for a while, then stop and wait for you.** One agent is fine. But real work looks
like this:

- Agent A is refactoring a module (busy for 3 minutes).
- Agent B just finished and is _waiting_ for you to say "yes, commit it."
- Agent C hit an error and is _stuck_.
- Meanwhile you're reading docs in a browser.

If all of these are just tabs in a normal terminal, **you have no idea who needs
you.** You end up manually clicking through panes like checking pots on a stove.
People try to solve this with tmux and a wall of split panes — but as one review
put it, that's _"held together with duct tape."_ There's no at-a-glance answer to
the only question that matters: **which agent needs me right now?**

**cmux** is a terminal designed around that question. Its headline features all
serve it:

- A **vertical sidebar** listing every workspace by name.
- A **status line** under each name ("Claude is waiting for your input").
- **Notification rings** — a pane/tab lights up the moment an agent needs you.
- **Split panes** so related terminals live together.
- A **socket API** so agents can _tell_ the app what's happening.

The result: you start three agents, look away, and the UI _pings you_ when
someone needs attention. You respond, then go back to what you were doing.

---

## 1.2 Why we're building Shepherd

cmux is a **native macOS app** (written in Swift/AppKit, built on Ghostty's GPU
terminal engine). It is genuinely excellent — and **completely unavailable on
Linux.** There is no equivalent. That's the gap we're filling.

We did **not** fork cmux or port Swift. Shepherd began by studying the product
gap and public concepts, then implemented its own Electron runtime, semantic
agent model, Linux process discovery, worktree flow, observability, UI, and
automation. The project now has an independent name and direction.

> **🔧 In Shepherd:** the enduring product goal is a named sidebar on the left,
> tiled terminals on the right, and agents that clearly signal when they need
> you. Later milestones extend that foundation beyond visual parity.

---

## 1.3 The 10,000-foot architecture

Here is the entire app in one picture. Spend a minute here — the rest of the book
is just zooming into each box.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          Shepherd (one Electron app)                      │
│                                                                             │
│   ┌────────────────────────────┐         ┌────────────────────────────┐    │
│   │   RENDERER PROCESS          │  IPC    │   MAIN PROCESS              │    │
│   │   (Chromium + your React)   │◄──────► │   (Node.js runtime)         │    │
│   │                             │ preload │                             │    │
│   │  • Sidebar (workspaces)     │ bridge  │  • Spawns shells (node-pty) │    │
│   │  • Tabs / split panes       │         │  • Unix socket API server   │    │
│   │  • xterm.js terminals       │         │  • Watches for OSC codes    │    │
│   │  • All the CSS / the "look" │         │  • Saves/restores sessions  │    │
│   │                             │         │  • Desktop notifications    │    │
│   │      = "the frontend"       │         │      = "the backend"        │    │
│   └────────────────────────────┘         └──────────┬─────────────────┘    │
│                                                      │                       │
└──────────────────────────────────────────────────────┼──────────────────────┘
                                                        │ spawns & talks to
                                    ┌───────────────────┼───────────────────┐
                                    ▼                   ▼                   ▼
                               [ bash/zsh ]        [ claude code ]     [ any agent ]
                               real OS shells running inside the terminals
```

Two ideas do 90% of the work of understanding this:

1. **An Electron app is really two programs in a trench coat.** A **main process**
   (plain Node.js — think "your Express backend") and a **renderer process**
   (a Chromium window running your React app — think "your frontend"). They can't
   call each other directly; they pass messages over **IPC** (think "API calls").

2. **A terminal in the UI is a puppet.** The thing you _see_ (drawn by xterm.js in
   the renderer) is not the real shell. The **real shell** (bash) lives in the
   main process, spawned by node-pty. Keystrokes travel frontend → backend → shell;
   output travels shell → backend → frontend. xterm.js just paints what it's told.

If those two sentences click, you already understand the skeleton.

---

## 1.4 The stack: four technologies, four jobs

| Technology             | Lives in       | Its one job                                                      | Analogy                                 |
| ---------------------- | -------------- | ---------------------------------------------------------------- | --------------------------------------- |
| **Electron**           | both processes | Be the desktop app: open a window, run Node with OS access       | The building the app lives in           |
| **React + TypeScript** | renderer       | Draw the UI and hold the app's state                             | Same React you already write            |
| **xterm.js**           | renderer       | Render a terminal inside the window (paint text, colors, cursor) | A `<video>` element, but for a terminal |
| **node-pty**           | main           | Spawn and control the _real_ shell behind each terminal          | The puppeteer's hand inside the puppet  |

That's the whole cast. Everything else (the socket API, session save, OSC parsing)
is _Node code we write_ in the main process — no new framework required. This is
why the stack is a great fit for you: it's **React on the front, Node on the back,
and two small specialist libraries** (xterm.js, node-pty) bridging to the terminal
world.

> **⚠️ Gotcha:** node-pty and xterm.js sound similar but are opposite ends of the
> same wire. **node-pty = the real shell (backend).** **xterm.js = the picture of
> it (frontend).** Confusing them is the #1 beginner mix-up. Chapters 6 and 7
> drill this.

---

## 1.5 The core loop (the heartbeat of the app)

Almost everything Shepherd does is one of three round-trips across the IPC
bridge. Learn these three and you can predict how any feature is wired.

**Loop A — you type a command:**

```
key press in xterm.js (renderer)
  → window.api.sendInput(paneId, "l")        (preload)
  → IPC → main
  → ptyProcess.write("l")                     (node-pty → the real bash)
```

**Loop B — the shell prints output:**

```
bash prints "file1  file2\n"
  → pty.onData fires (main)
  → webContents.send("pty-data", {paneId, data})   (IPC → renderer)
  → term.write(data)                                (xterm.js paints it)
```

**Loop C — an agent needs attention:**

```
Claude Code finishes → its hook runs `shepherd notify --body "waiting..."`
  → the Shepherd CLI connects to the unix socket (main)
  → main marks that workspace "needs attention"
  → webContents.send("workspace-update", ...)   (IPC → renderer)
  → React lights up the sidebar row + rings the pane
  → main also fires an OS desktop notification
```

> **🔧 In Shepherd:** notice Loop C is why the socket API isn't an afterthought —
> it's how the sidebar comes alive. That's why `FEATURES.md` calls it "the
> backbone," and why we build a minimal version of it early (milestone M3), not
> last.

---

## 1.6 The object model (what the app is made of)

Shepherd uses a five-level hierarchy adapted from the original product research:

```
Window            an OS window; has its own sidebar
 └─ Workspace      one row in the sidebar (a named project/agent context)
     └─ Pane        a split region inside a workspace (⌘D splits it)
         └─ Surface  a tab within a pane (each pane has its own tab bar)
             └─ Panel  the actual content: a Terminal (or later, a Browser)
```

Mapping to what you see:

- The **left list** = Workspaces.
- Each **tiled rectangle** on the right = a Pane.
- The **little tabs** on top of a rectangle = Surfaces.
- The **terminal itself** = a Terminal Panel.

You don't need to internalize all five now — chapter 9 builds this into real
TypeScript types. Just know the vocabulary exists and is deeper than "tabs and
panes."

---

## 1.7 How the build maps onto all this

`ROADMAP.md` has seven milestones (M0–M6). Here's how they attack the architecture,
so the roadmap feels less like a list and more like a story:

| Milestone | What part of the picture it builds                                             |
| --------- | ------------------------------------------------------------------------------ |
| **M0**    | An empty Electron app — just the two-process shell, nothing inside.            |
| **M1**    | **Loop A + Loop B** for ONE terminal. The single hardest, most important step. |
| **M2**    | Many terminals + the Pane/Surface tiling (the object model, made real).        |
| **M3**    | The Workspace sidebar + a minimal socket server feeding it.                    |
| **M4**    | **Loop C** — real agents lighting up the sidebar + saving/restoring sessions.  |
| **M5**    | The _full_ socket API (automation: create/split/send programmatically).        |
| **M6**    | Theming + packaging so it looks finished and installs cleanly.                 |

Every milestone is "make one more part of section 1.3 real." When you're lost
mid-build, come back to that diagram and ask _which box am I in right now?_

---

## 1.8 The mental model to carry everywhere

If you remember nothing else from this chapter, carry these five sentences:

1. **An Electron app = a Node backend (main) + a React frontend (renderer).**
2. **They talk only through IPC — treat it exactly like frontend↔backend API calls.**
3. **The terminal you see (xterm.js) is a puppet; the real shell (node-pty) is in the backend.**
4. **The sidebar comes alive through a socket API that agents send messages to.**
5. **Everything is Window → Workspace → Pane → Surface → Panel.**

Every chapter that follows is a deep dive into one of those five sentences.

---

## 🧪 Checkpoint

Answer these before moving on (answers are all in this chapter):

1. When you press a key in a terminal, which process does the _real_ shell live in
   — main or renderer? How does your keystroke get there?
2. xterm.js and node-pty — which is the "picture" and which is the "real shell"?
3. In one sentence, why is the socket API central rather than optional?
4. Name the five levels of the object model, top to bottom.
5. Which milestone builds "Loop A + Loop B for one terminal," and why is it called
   the make-or-break step?

---

## Summary

Shepherd answers "which agent needs me?" by wrapping real terminals in a UI with
a named sidebar and notification rings. Technically, it's **one Electron app split
into a Node backend (main) and a React frontend (renderer)** that communicate over
**IPC**. **node-pty** runs the real shells in the backend; **xterm.js** paints them
in the frontend; a **unix socket API** lets agents drive the sidebar. Its data is
organized as **Window → Workspace → Pane → Surface → Panel**, and the whole app is
really just three IPC round-trips (type, print, notify) repeated forever.

## Where this shows up next

- The two-process model → `03-electron-architecture.md`
- The IPC round-trips → `04-ipc-inter-process-communication.md`
- The real shell (node-pty) → `06-node-pty.md`; the picture (xterm.js) → `07-xtermjs.md`
- The socket "magic" → `11-the-socket-api.md` and `12-notifications-and-osc.md`
- The end-to-end synthesis → `17-how-it-all-connects.md`

## Further reading

- cmux itself (our inspiration): https://cmux.com and https://github.com/manaflow-ai/cmux
- Our own `FEATURES.md` (feature parity map) and `ROADMAP.md` (build order)
