# Chapter 17 — How It All Connects

> **What you'll learn**
> - How every technology in this book cooperates to make one feature work
> - A byte-by-byte trace of a single keystroke, across every layer
> - A step-by-step trace of an agent notification lighting up the sidebar
> - A map from each concept/chapter to its place in the running app
>
> **Prerequisites:** ideally all previous chapters. This is the capstone that ties
> them together — but it also works as a "big review" if you've read the
> foundations (01–07) and skimmed the rest.

---

## 17.1 Why this chapter exists

You've now met every part in isolation: terminals (ch 2), Electron's two processes
(ch 3), IPC (ch 4), the preload bridge (ch 5), node-pty (ch 6), xterm.js (ch 7),
React (ch 8), the data model (ch 9), tiling (ch 10), the socket API (ch 11),
notifications (ch 12), persistence (ch 13), and how it's all built and shipped
(ch 14–15).

Understanding each part is necessary but not sufficient. The *insight* is in how
they hand off to each other. So we'll follow **two complete journeys** through the
whole system, naming the chapter behind every hop. If you can narrate these two
traces from memory, you understand cmux-linux.

---

## 17.2 Journey 1 — you type `ls` and press Enter

You're focused on a terminal pane. You type the letter `l`. Watch it travel.

```
   RENDERER (Chromium)                                     MAIN (Node.js)
 ┌───────────────────────────┐                        ┌───────────────────────────┐
 │ 1. You press "l"           │                        │                           │
 │ 2. xterm.js term.onData    │                        │                           │
 │    fires with "l"  (ch 7)  │                        │                           │
 │ 3. calls window.api        │                        │                           │
 │    .sendInput(paneId,"l")  │                        │                           │
 │       (preload,  ch 5)     │                        │                           │
 │            │               │   IPC: "pty:input"     │                           │
 │            └───────────────┼──────invoke───────────►│ 4. ipcMain.handle         │
 │                            │        (ch 4)          │    ("pty:input")  (ch 4)   │
 │                            │                        │ 5. look up pty by paneId   │
 │                            │                        │    in the Map  (ch 6)      │
 │                            │                        │ 6. ptyProcess.write("l")   │
 │                            │                        │       (node-pty,  ch 6)    │
 │                            │                        │            │              │
 └───────────────────────────┘                        └────────────┼──────────────┘
                                                                    ▼
                                                        ┌───────────────────────────┐
                                                        │  the real bash shell       │
                                                        │  receives "l" on its stdin │
                                                        │  via the PTY  (ch 2)       │
                                                        └───────────────────────────┘
```

Nothing visible has happened yet — bash has just received one byte. In *raw mode*
(ch 2) the shell (via its line editor) decides to echo it back so you can see what
you typed. That echo is **output**, which begins Journey 1's return leg.

You repeat this for `s`, then Enter (`\r`). On Enter, bash has a full line `ls`,
runs it, and the command prints its result. Now the **output** flows back:

```
   the bash shell prints:  "file1  file2\n"   (plus the earlier echoes)
              │
              ▼  the PTY master delivers those bytes to node-pty  (ch 2, ch 6)
 ┌───────────────────────────┐                        ┌───────────────────────────┐
 │   RENDERER (Chromium)      │                        │   MAIN (Node.js)          │
 │                            │                        │ 7. pty.onData fires with   │
 │                            │   IPC: "pty:data"      │    "file1  file2\n" (ch 6) │
 │ 9. ipcRenderer.on          │◄──────push─────────────┤ 8. webContents.send        │
 │    ("pty:data")  (ch 4/5)  │      (ch 4)            │    ("pty:data",{paneId,…}) │
 │10. term.write(data) (ch 7) │                        │    ALSO: OSC scan  (ch 12) │
 │11. xterm.js parses ANSI    │                        │                           │
 │    codes, paints glyphs,   │                        │                           │
 │    moves the cursor (ch 2) │                        │                           │
 │ →  you SEE "file1 file2"   │                        │                           │
 └───────────────────────────┘                        └───────────────────────────┘
```

**Key realizations from Journey 1:**
- The terminal you see is a **puppet** (ch 7); the real shell is in the backend
  (ch 6). This is chapter 1's core sentence, made concrete.
- Your keystroke crossed the IPC bridge **twice** (once out as input, the echo/
  output comes back) — every visible character is a round trip (ch 4).
- Step 8 quietly does double duty: the same output bytes that go to xterm are also
  scanned for OSC notification codes (ch 12). That's the hook for Journey 2.

> **🔧 In cmux-linux:** this exact path is milestone **M1** in `ROADMAP.md` — "one
> terminal you can type in." Now you can see why the roadmap calls it make-or-break:
> it exercises the entire renderer↔preload↔IPC↔main↔node-pty spine at once.

---

## 17.3 Journey 2 — an agent needs approval and its terminal comes to you

This is the structured lifecycle journey. Claude Code is running in one pane and
reaches a permission request.

```text
 STEP 1  Claude Code emits a PermissionRequest lifecycle event as JSON.
         A hook installed by `cmux integrations setup claude` runs:
           command -v cmux >/dev/null 2>&1 && cmux agent-hook claude

 STEP 2  The hook runs inside the pane, so its environment has:
           CMUX_WORKSPACE_ID, CMUX_SURFACE_ID, CMUX_SOCKET_PATH

 STEP 3  bin/agent-events.js maps the provider event to:
           state=blocked, blockReason=approval

 STEP 4  The CLI sends one newline-terminated `agent-report` request to the
         Unix socket, including the pane's workspace and surface identity.
```

Now the report crosses main and renderer:

```text
 ┌───────────────────────────────── MAIN (Node.js) ───────────────────────────┐
 │ STEP 5  buffer socket bytes and split complete lines on "\n"                │
 │ STEP 6  resolve the workspace using the renderer mirror                    │
 │ STEP 7  validate provider/state/reason/source/ids; stamp local time         │
 │ STEP 8  push a typed socket:command through the preload IPC bridge          │
 └───────────────────────────────────────┬─────────────────────────────────────┘
                                         │
                                         ▼
 ┌────────────────────────────── RENDERER (React) ────────────────────────────┐
 │ STEP 9  appReducer proves the surface exists and derives its pane          │
 │ STEP 10 upsert the AgentRecord and derive workspace unread/attention       │
 │ STEP 11 AgentList renders "Claude Code · waiting approval" first           │
 │ STEP 12 you click the row; focusAgent selects workspace, pane, and surface │
 │ STEP 13 TerminalHost refits and focuses the exact xterm.js instance        │
 └────────────────────────────────────────────────────────────────────────────┘
```

OSC 9/99/777 remains a second, zero-setup notification channel. It can light a
workspace for any compatible program, but it does not manufacture a structured
agent identity or semantic state. Explicit notifications and semantic lifecycle
reports share the socket/IPC infrastructure while keeping different contracts.

> **🔧 In cmux-linux:** the socket and notification foundation comes from M3/M4;
> the semantic contract, lifecycle controls, exact focus, and provider adapters
> are M7 and Chapter 19.

---

## 17.4 The whole system on one page

Every chapter, placed on the map:

```
                         cmux-linux
   ┌──────────────────────────────────────────────────────────────┐
   │ RENDERER (Chromium)                    MAIN (Node.js)         │
   │                                                                │
   │  React app ....................... ch 8    Electron app ... ch 3│
   │   ├─ Sidebar (Workspaces) ........ ch 8     ├─ node-pty .... ch 6│
   │   │   └─ rings/flash/badges ...... ch 12    ├─ OSC scanner . ch 12│
   │   ├─ PaneTree (tiling) ........... ch 10    ├─ socket server ch 11│
   │   │   └─ Pane → Surfaces ......... ch 9      ├─ persistence . ch 13│
   │   └─ TerminalPane (xterm.js) ..... ch 7      └─ desktop notify ch 12│
   │                                                                │
   │        ▲   window.api (preload) .. ch 5                        │
   │        │   IPC channels ........... ch 4                        │
   │        └───────────────────────────┴──── data model ....... ch 9│
   │                                                                │
   │  terminal internals (TTY/PTY/ANSI/OSC) underpin it all .... ch 2│
   │  built & bundled by Vite ................................. ch 14│
   │  packaged as AppImage/.deb .............................. ch 15│
   └──────────────────────────────────────────────────────────────┘
```

And the object model (ch 9) threading through it:
`Window → Workspace(sidebar row, ch 8/12) → Pane(tiling, ch 10) → Surface(tab, ch 9) → Panel(xterm terminal, ch 7)`.

---

## 17.5 Reading the codebase after this

When we start building and you open a file, locate it on the map above and ask the
three questions this book trained you to ask:

1. **Which process am I in** — main (backend) or renderer (frontend)? (ch 3)
2. **How does data get in and out of here** — an IPC channel (ch 4), the socket
   (ch 11), or a pty stream (ch 6)?
3. **What part of `Window→Workspace→Pane→Surface→Panel` does this touch?** (ch 9)

Those three questions will orient you in any file in the project.

---

## 🧪 Checkpoint (the capstone test)

If you can do these from memory, you've understood the whole book:

1. Narrate Journey 1 (a keystroke → visible output) naming every process boundary
   it crosses and which library owns each end.
2. Narrate Journey 2 (an agent notification → a glowing sidebar row) including the
   **two** different on-ramps (the `cmux` CLI vs an OSC escape code).
3. Point to where in Journey 1 the notification system secretly gets its input.
4. For each of these, say which process it lives in: node-pty, xterm.js, the socket
   server, the React sidebar, the OSC scanner, `window.api`.
5. Map Journeys 1 and 2 onto the M-numbered milestones in `ROADMAP.md`.

---

## Summary

cmux-linux is not a pile of separate technologies — it's two processes passing
messages, with specialist libraries at the edges. **A keystroke** proves the
renderer↔main spine: xterm.js (ch 7) → preload (ch 5) → IPC (ch 4) → node-pty
(ch 6) → the real shell (ch 2), and back. **A notification** proves the cmux magic:
an agent → the socket API or an OSC code (ch 11/12) → the main-process state (ch 9)
→ an IPC push → the React sidebar's ring (ch 8/12). Learn those two journeys and
every file you open later has an obvious home.

## Where this shows up next
- Turn understanding into building: `ROADMAP.md` (M0 → M6).
- Refresh any single hop: jump to its chapter via `00-INDEX.md`.
- Look up any unfamiliar word: `16-glossary.md`.

## Further reading
- Re-read `01-the-big-picture.md` — it will now read completely differently.
- cmux, for comparison with the real thing: https://cmux.com and https://github.com/manaflow-ai/cmux
