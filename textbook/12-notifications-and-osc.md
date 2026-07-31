# Chapter 12 — Notifications & OSC Escape Codes

> **What you'll learn**
>
> - The **two ways** a workspace lights up — _automatic_ OSC detection and _explicit_ socket notifications — and why they funnel into a single pipeline
> - What an **OSC (Operating System Command)** escape sequence is at the byte level: `ESC ] <code> ; <payload> <BEL or ST>`
> - The specific notification codes: **OSC 9** (iTerm-style), **OSC 777** (urxvt notify), **OSC 99** (kitty), and **OSC 9;4** (progress)
> - How to **scan the node-pty output stream** for these in the _main_ process **without corrupting** the bytes xterm.js draws
> - Why an escape sequence can be **split across two `data` chunks**, and the buffering that fixes it (the same framing lesson as Chapter 11)
> - The unified **attention pipeline**: `markWorkspaceAttention(...)` → state → `webContents.send('workspace:update')` → the ring/flash/badge + a desktop toast
> - The **visual layer**: CSS `@keyframes` rings, flashing sidebar rows, unread badges, the notification panel, jump-to-latest-unread, and the green/yellow/red color convention
> - Wiring **Electron's `Notification` API** and **debouncing** notification spam
>
> **Prerequisites:** **chapter 06** (`06-node-pty.md` — you must know how `pty.onData` streams a shell's raw output) and **chapter 11** (`11-the-socket-api.md` — the `notification.create` / `set-status` methods and the `webContents.send('workspace:update')` handoff). A live memory of **Loop C** from `01-the-big-picture.md` is the spine of this chapter.

---

## 12.1 Two doorbells, one bell

This chapter is about the single feature that gives cmux its reason to exist: the
moment a workspace **lights up because an agent needs you.** Go back to **Loop C**
from Chapter 1 one more time — it's about to become fully concrete:

```
Claude Code finishes → its hook runs `shepherd notify --body "waiting..."`
  → the Shepherd CLI connects to the unix socket (main)
  → main marks that workspace "needs attention"
  → webContents.send("workspace-update", ...)   (IPC → renderer)
  → React lights up the sidebar row + rings the pane
  → main also fires an OS desktop notification
```

Here's the twist this chapter adds: **there are two completely different ways the
"needs attention" state gets set, and they meet in the middle.** `FEATURES.md`
Part 4 calls them the _two input channels_:

- **① Explicit (the front door).** An agent runs `shepherd notify …` (or
  `shepherd set-status …`). That travels the **socket API** you built in Chapter 11 —
  `notification.create` / `set-status`. This is a _deliberate_ push: the agent
  _knows_ about cmux and calls its CLI, usually from a **hook** (`shepherd hooks setup`
  installs a Claude Code `Notification` hook — §12.2).
- **② Automatic (the passive sensor).** cmux **watches the raw terminal output**
  streaming out of node-pty for special **OSC escape sequences** (OSC 9 / 99 / 777).
  _Any_ program that emits one — an agent, a `make` script, a bare
  `printf '\e]9;done\a'` — triggers a notification with **zero setup and zero
  knowledge of cmux.** The terminal itself is the sensor.

Think of it like a building with **two doorbells wired to the same chime.** One is
the front-door button a visitor presses on purpose (the socket). The other is a
motion sensor on the porch that fires whenever _anything_ moves (the OSC scanner).
Press the button or trip the sensor — the same chime rings inside. In cmux, that
"chime" is one function, **`markWorkspaceAttention(wsId, payload)`**, and both
channels call it:

```
   ┌─────────────────────────────────────────────┐
   │  CHANNEL ①  EXPLICIT (Chapter 11)            │
   │                                              │
   │  agent hook → `shepherd notify` → socket API →   │
   │  HANDLERS['notification.create'] ────────────┼──┐
   └─────────────────────────────────────────────┘  │
                                                     │   both call the
   ┌─────────────────────────────────────────────┐  │   SAME function
   │  CHANNEL ②  AUTOMATIC (this chapter)         │  │        │
   │                                              │  │        ▼
   │  shell prints "\e]9;Build done\a"            │  │   markWorkspaceAttention(
   │  → node-pty onData (main)                    │  │       wsId, payload)
   │  → OSC scanner spots OSC 9 ──────────────────┼──┘        │
   └─────────────────────────────────────────────┘           │
                                                              ▼
                        update Workspace state (attention/unread/notifications)
                                                              │
                          ┌───────────────────────────────────┼───────────────────┐
                          ▼                                                         ▼
        webContents.send('workspace:update', ws)                        new Notification({...}).show()
        → React: ring + flash + unread badge                            → an OS desktop toast
                    (§12.9)                                                     (§12.10)
```

Everything below is a zoom into one box of that picture. We spend the first half on
**Channel ②** (the OSC escape codes and how to parse them safely — this is the new
material), then reunite both channels at `markWorkspaceAttention` and build the
visual payoff.

> **🔧 In Shepherd:** Channel ① is _already done_ — you built it in Chapter 11.
> `notification.create` mutates `ws.notifications` and calls
> `markWorkspaceAttention` (you saw the stub in §11.6). Channel ②, the OSC scanner,
> is what M4 adds. The genius of routing both through one function is that the
> **entire visual layer — rings, flash, badge, desktop toast — is written once**
> and neither channel knows or cares which doorbell was pressed.

---

## 12.2 A 60-second recap of the explicit channel (Chapter 11)

Before we leave the explicit channel behind, let's nail down the piece this chapter
depends on: **how a real agent presses the front-door button.** You saw this in
Chapter 11 §11.7, but it's the reason automatic detection even matters, so it earns
a recap.

AI agents expose lifecycle extension points. `shepherd integrations setup` installs
guarded command hooks for Codex and Claude Code and a managed event plugin for
OpenCode. Those adapters convert tool, permission, completion, failure, and
session events into the semantic `agent-report` protocol described in Chapter 19.
The pane environment from §11.9 already identifies the owning workspace and
terminal.

The older explicit path remains useful: an agent or script can run
`shepherd notify …` itself, and `shepherd hooks setup` remains a compatibility alias for
Claude Code integration setup. Structured lifecycle reports and explicit
notifications both cross the Unix socket, but they remain separate state models:
the first maintains current agent state; the second creates a notification/status
signal.

So why do we _also_ need to sniff escape codes? Because **not every program is an
agent that knows about cmux.** A long `webpack` build, a test runner, a
`brew upgrade`, a script a coworker wrote — none of them will ever run `shepherd notify`.
But many of them _already_ emit a **desktop-notification escape code**, because
that's a decades-old terminal convention that iTerm2, kitty, urxvt, and others all
honor. If cmux listens for those codes, it inherits notifications from the entire
ecosystem **for free.** That's Channel ②. To understand it, we need to understand
escape codes.

---

## 12.3 What is an escape code, really? (a Node dev's primer)

Here's the mental unlock. When bash prints something, it doesn't send _only_ the
letters you see. **It sends a single byte stream that interleaves two kinds of
bytes:**

1. **Visible bytes** — the actual characters (`f`, `i`, `l`, `e`).
2. **Invisible control bytes** — instructions _to the terminal_: "turn the text
   red now," "move the cursor up two lines," "set the window title," "post a
   desktop notification."

You already know this pattern from the web, you just call it something else:

- An **HTML document** interleaves content (`Hello`) with markup the browser acts on
  but doesn't literally print (`<b>`, `<!-- comment -->`). The `<b>` isn't shown; it
  _changes how the next text is shown._
- A **log stream** might interleave human text with `\n`, `\t`, or ANSI color codes.

Terminal escape codes are the terminal's version of `<b>`: **inline, out-of-band
instructions living inside the same stream as the visible text.** Chapter 2
(`02-how-terminals-work.md`) covers them in general; here we need one specific
family.

Every escape code starts with the **ESC** byte — hex `0x1B`, which shows up in
strings as `\x1b`, `\e`, `\033`, or `^[`. ESC means "the next few bytes are an
instruction, not text." What follows ESC splits into families:

| Family                                | Starts with | Job                                                                          | Example                                    |
| ------------------------------------- | ----------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| **CSI** (Control Sequence Introducer) | `ESC [`     | cursor movement, colors, erase                                               | `\x1b[31m` = "text is red now"             |
| **OSC** (Operating System Command)    | `ESC ]`     | talk to the _window system_: title, clipboard, hyperlinks, **notifications** | `\x1b]0;My Title\x07` = "set window title" |

Notice the one-character difference: **`ESC [` is CSI, `ESC ]` is OSC.** CSI is for
_drawing_; OSC is for _asking the operating system / window for something_. Desktop
notifications are inherently an "ask the OS" operation — so they live in **OSC.**
That's the family we sniff for.

> **⚠️ Gotcha — the escape byte is invisible, not absent.** When you `console.log`
> a chunk of pty output in Node, ANSI-aware terminals will _act on_ the escape bytes
> instead of showing them, so your logs look "clean" and you'll swear there are no
> escape codes in there. There are — they're just being interpreted. To actually see
> them, print `JSON.stringify(chunk)` (which renders ``) or pipe through
> `cat -v` (which shows ESC as `^[`). You will debug this chapter blind if you forget
> this.

---

## 12.4 OSC anatomy: `ESC ] <code> ; <payload> <terminator>`

Every OSC sequence has exactly four parts. Memorize this shape — the parser in §12.6
is nothing but code that recognizes it:

```
   ESC     ]      9      ;     B  u  i  l  d     d  o  n  e      BEL
  ┌────┐ ┌────┐ ┌────┐ ┌───┐ ┌───────────────────────────────┐ ┌────┐
  │0x1B│ │0x5D│ │ 57 │ │0x3B│ │      the payload (a string)    │ │0x07│
  └────┘ └────┘ └────┘ └───┘ └───────────────────────────────┘ └────┘
   the    OSC    the    sep      what the command operates on     the
   escape intro  code                                             terminator
   ─────  ─────  ────                                             ─────────
   "an    "…of   "which  "…"     "…with this data…"               "…the end."
   escape  the   OSC
   is      OSC    command"
   coming" kind"
```

As a raw JavaScript string that's just: `"\x1b]9;Build done\x07"`.

Four parts, in order:

1. **`ESC ]`** — the two-byte **introducer** (`0x1B 0x5D`). "An OSC is starting."
2. **`<code>`** — a number naming the command (`9`, `777`, `99`, `0`, `8`…). This is
   the "route," exactly like `method` in your socket protocol.
3. **`;`** — a separator, then the **`<payload>`** — the command's argument(s).
   Some codes sub-divide the payload with more semicolons (OSC 777 does).
4. **`<terminator>`** — the byte(s) that say "the OSC is over." **There are two legal
   terminators, and you must accept both:**

| Terminator | Name              | Bytes                 | As a string                        |
| ---------- | ----------------- | --------------------- | ---------------------------------- |
| **BEL**    | Bell              | `0x07`                | `\x07` (also written `\a` or `^G`) |
| **ST**     | String Terminator | `0x1B 0x5C` (`ESC \`) | `\x1b\\`                           |

Why two? History. The original, spec-correct terminator is **ST** (`ESC \`). But
early terminals accepted the **BEL** character (`0x07` — the byte that used to
literally ring a bell) as a convenient one-byte shorthand, and it stuck. Most
programs emit **BEL**; some (kitty especially) emit **ST**. **A correct parser
treats either as "the end."** Forgetting one is a top-three bug in this chapter.

> **Analogy:** think of `ESC ]` as `{` (start of an object), the code+payload as its
> contents, and BEL/ST as `}` (end of the object). Just like you can't parse JSON
> without finding the matching `}`, you can't extract an OSC without finding its
> terminator — and, just like a socket, that terminator might not have _arrived yet_
> when your `data` handler fires. Hold that thought for §12.5.

### The four notification codes we care about

Different terminals invented their own notification codes over the years. We support
the common set so cmux "just works" no matter which convention a program follows:

| OSC     | Origin                    | Format (string form)                 | What it means                                               |
| ------- | ------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| **9**   | iTerm2                    | `\x1b]9;<message>\x07`               | Post a desktop notification; the payload **is** the message |
| **777** | urxvt (rxvt-unicode)      | `\x1b]777;notify;<title>;<body>\x07` | Notification with a **title and body**                      |
| **99**  | kitty                     | `\x1b]99;<metadata>;<body>\x1b\\`    | Rich notification (id, urgency…); metadata before the body  |
| **9;4** | ConEmu / Windows Terminal | `\x1b]9;4;<state>;<percent>\x07`     | Not a notification — a **progress bar** update              |

Real bytes for each, so you can recognize them in a hex dump:

```
 OSC 9    (iTerm notify):   1B 5D 39 3B  42 75 69 6C 64 20 64 6F 6E 65  07
                            ␛  ]  9  ;    B  u  i  l  d  ␣  d  o  n  e   ␇
                            = "\x1b]9;Build done\x07"

 OSC 777  (urxvt notify):   "\x1b]777;notify;Deploy;All checks passed\x07"
                             code│ sub   │title │      body
                             777 │notify │Deploy│All checks passed

 OSC 99   (kitty notify):   "\x1b]99;;Tests finished\x1b\\"
                             code│ meta │  body        │ ST terminator (ESC \)
                             99  │(empty)│Tests finished│

 OSC 9;4  (progress):       "\x1b]9;4;1;80\x07"   → progress bar at 80%
                            "\x1b]9;4;0;\x07"      → clear the progress bar
```

Two of these have a wrinkle worth pre-empting now, because the parser has to handle
them:

- **OSC 9 is overloaded.** iTerm uses bare `9;<text>` for notifications, but ConEmu
  uses `9;4;…` for _progress_. So when you see OSC code `9`, you must **peek at the
  payload**: if it starts with `4;`, it's a progress update (route it to the progress
  bar — the same one `shepherd set-progress` drives in Chapter 11); otherwise it's a
  notification. We handle exactly this branch in §12.6.
- **OSC 777 sub-commands.** `777` was urxvt's catch-all extension channel; the first
  payload field is a _sub-command_. We only care about `notify`. Anything else
  (`777;something-else;…`) we ignore.
- **OSC 99 metadata.** kitty's protocol puts optional `key=value` metadata (like
  `i=1:d=0`) _before_ the body and can even chunk one notification across several OSC
  99s. For v1 we take the body after the first `;` and ignore the metadata/chunking.
  (An honest scope cut — see the gotcha in §12.6.)

> **🔧 In Shepherd:** we treat **OSC 9 / 777 / 99** as three dialects of "post a
> notification" and normalize all of them to one internal shape,
> `{ title, body }`, before they ever reach `markWorkspaceAttention`. Downstream code
> never sees an escape code — it sees a clean `{title, body}` object, identical to
> what the socket's `notification.create` produces. One normalization point, one
> pipeline.

---

## 12.5 Sniffing the stream without breaking the terminal

Now the central engineering problem of this chapter. Recall **Loop B** from Chapter
1 — how shell output reaches the screen:

```
bash prints bytes
  → pty.onData fires (MAIN)                         ← Chapter 6
  → webContents.send("pty-data", {paneId, data})    ← IPC to renderer
  → term.write(data)                                 ← xterm.js paints it (Chapter 7)
```

The OSC notification codes are riding _inside_ that same `data`. We want to **notice
them in the main process** — but the bytes are also on their way to xterm.js, which
is a _real terminal emulator_ that will parse the same stream. This creates the
prime directive of the whole feature:

> **The golden rule: OBSERVE, don't CONSUME.** The bytes we forward to xterm.js must
> be **byte-for-byte identical** to what the shell emitted. We scan a _copy_ for
> notifications; we never mutate, strip, reorder, or re-buffer the stream on its way
> to the renderer.

Why so strict? Two reasons:

1. **xterm.js needs the full, exact stream.** A terminal emulator is a state machine.
   If you delete bytes mid-stream — even bytes you _think_ are "just a notification"
   — you can desync its parser: split a color code in half, truncate a cursor move,
   drop a UTF-8 continuation byte, and the display corrupts (garbage characters,
   wrong colors, a stuck cursor). Some OSCs xterm.js legitimately _wants_ (OSC 0/2 =
   window title, OSC 8 = clickable hyperlinks). A blanket "strip OSC codes" pass
   would break those. **Don't be a middleman that edits the mail.**
2. **We don't need to strip them anyway.** xterm.js **safely ignores OSC codes it
   has no handler for.** OSC 9/777/99 aren't things base xterm.js renders, so it just
   skips them — no visible artifact. Leaving them in costs nothing; removing them
   risks everything.

So the shape is a **tee**: one stream in, forwarded unchanged, with a _branch_ that
feeds a scanner.

```
                       ┌────────────────────────────► webContents.send('pty-data', {paneId, data})
                       │        (RAW, unmodified)            → xterm.js paints it (pristine)
   pty.onData(data) ───┤
                       │
                       └────────────────────────────► oscScanner.push(paneId, data)
                                (a COPY, read-only)          → detect OSC 9/777/99 → notify
```

In code, the entire integration point is these few lines in the main process,
right where Chapter 6 wires up node-pty:

```ts
// main/spawnPane.ts  (extending the pty setup from Chapter 6)
import { oscScanner } from './oscScanner'

ptyProcess.onData((data: string) => {
  // 1) Forward the RAW bytes to the renderer, untouched. This is Loop B.
  //    xterm.js is the real terminal; it must see exactly what the shell wrote.
  mainWindow.webContents.send('pty-data', { paneId, data })

  // 2) Separately, feed a COPY into the OSC scanner. This never mutates `data`.
  oscScanner.push(paneId, data)
})
```

That's the whole tee. `data` is a string; strings in JS are immutable, so passing it
to two functions can't accidentally let one corrupt the other. The order doesn't even
matter — we could scan first — because neither call changes `data`.

> **⚠️ Gotcha — never forward the scanner's buffer.** The scanner (next section)
> keeps its own _accumulator_ to reassemble split sequences. The single most
> destructive bug in this feature is to accidentally send **that accumulator** to
> xterm.js instead of the raw `data` argument — you'll duplicate bytes (the buffer
> still holds a chunk you already forwarded) and paint garbage. **The renderer only
> ever receives the untouched `data`.** The buffer is a private, internal, detection-
> only structure. Keep the two variables in different functions so you can't confuse
> them.

> **🔧 In Shepherd:** an alternative exists — xterm.js lets the _renderer_ register
> `term.parser.registerOscHandler(9, cb)`. Why do we scan in **main** instead? Because
> the things a notification triggers — mutating the `Workspace` store, firing an
> Electron **`Notification`** (a main-process API), broadcasting over IPC — **all
> live in main.** Detecting in the renderer would mean bouncing every hit _back_ to
> main over IPC anyway. Main also sees the pty stream _first_, before the IPC hop.
> So we detect where the consequences live: the main process, on `pty.onData`.

---

## 12.6 The buffering problem (and why you've already solved it)

Here is the gotcha that makes this more than a one-line regex. **A `data` event is
not a message.** You learned this exact lesson in Chapter 11 §11.3 for the socket:
the kernel hands you _whatever bytes happened to be ready_, with no respect for where
a logical unit begins or ends. node-pty's `onData` has the identical property. So a
single notification escape sequence can be **split across two (or more) `data`
events:**

```
  What the shell emitted (one logical OSC 9):
      "\x1b]9;Tests passed\x07"

  What pty.onData MIGHT deliver:
      data #1:  "...ok\r\n\x1b]9;Tests"      ← OSC started, NOT terminated
      data #2:  " passed\x07$ "               ← the rest + terminator + shell prompt
```

If your detector runs a regex on each chunk _independently_, it sees `\x1b]9;Tests`
in chunk #1 (no terminator → no match, dropped) and `passed\x07$` in chunk #2 (no
introducer → no match, dropped). **The notification vanishes.** It works perfectly in
dev with short messages that fit one chunk, then silently fails in production under
real output volume. Sound familiar? It's the same trap as `JSON.parse(chunk)` on the
socket.

The fix is the same tool: a **per-pane buffer.** Accumulate bytes, extract every
_complete_ OSC sequence, and **retain any unterminated tail** for the next event.

```
   data #1 → buffer = "...ok\r\n\x1b]9;Tests"
             scan: found "\x1b]" but NO terminator → it's partial → KEEP it, wait
   data #2 → buffer = "\x1b]9;Tests" + " passed\x07$ " = "\x1b]9;Tests passed\x07$ "
             scan: "\x1b]" ... "\x07" → COMPLETE → payload = "9;Tests passed" ✅
             leftover "$ " has no "\x1b]" → discard
```

Each pane gets its **own** buffer (two panes' streams must never mix — just like each
socket connection had its own buffer in Chapter 11). Here's the complete scanner:

```ts
// main/oscScanner.ts
import { markWorkspaceAttention } from './attention'
import { setWorkspaceProgress } from './progress'
import { workspaceIdForPane } from './store'

const OSC_START = '\x1b]' // ESC ]
const BEL = '\x07' // one-byte terminator
const ST = '\x1b\\' // two-byte terminator: ESC \

// A stray "\x1b]" in binary output (e.g. `cat somefile.bin`) has no terminator and
// would grow the buffer forever. Real notifications are short; cap and bail.
const MAX_OSC_LEN = 4096

class OscScanner {
  private buffers = new Map<string, string>() // paneId → leftover bytes

  push(paneId: string, chunk: string) {
    let buf = (this.buffers.get(paneId) ?? '') + chunk

    while (true) {
      const start = buf.indexOf(OSC_START)
      if (start === -1) {
        // No OSC introducer at all. Keep only a trailing lone ESC — it might be
        // the first half of an "\x1b]" whose "]" arrives in the next chunk.
        buf = buf.endsWith('\x1b') ? '\x1b' : ''
        break
      }

      // Everything before the introducer is ordinary terminal text we don't care
      // about (xterm.js already got the real copy). Drop it.
      buf = buf.slice(start)

      // Find the terminator: BEL (\x07) or ST (\x1b\\), whichever comes first.
      const bel = buf.indexOf(BEL)
      const st = buf.indexOf(ST, 2) // start at 2 to skip the opening ESC of "\x1b]"
      let end = -1,
        termLen = 0
      if (bel !== -1 && (st === -1 || bel < st)) {
        end = bel
        termLen = 1
      } else if (st !== -1) {
        end = st
        termLen = 2
      }

      if (end === -1) {
        // Terminator hasn't arrived yet → PARTIAL sequence. Keep it and wait...
        // ...unless it's absurdly long, in which case it isn't a real OSC — bail.
        if (buf.length > MAX_OSC_LEN) buf = ''
        break
      }

      const payload = buf.slice(2, end) // between "\x1b]" and the terminator
      this.handleOsc(paneId, payload)
      buf = buf.slice(end + termLen) // consume it; keep scanning for more
    }

    this.buffers.set(paneId, buf)
  }

  private handleOsc(paneId: string, payload: string) {
    // payload looks like "<code>;<rest>"  (e.g. "9;Build done")
    const semi = payload.indexOf(';')
    const code = semi === -1 ? payload : payload.slice(0, semi)
    const rest = semi === -1 ? '' : payload.slice(semi + 1)

    switch (code) {
      case '9': {
        // OSC 9 is overloaded: "9;4;…" is ConEmu PROGRESS, not a notification.
        if (rest.startsWith('4;')) {
          const [, state, pct] = rest.split(';') // "4;<state>;<pct>"
          return setWorkspaceProgress(paneId, Number(state), Number(pct))
        }
        // iTerm-style: the whole payload after "9;" is the message.
        return this.notify(paneId, { title: 'Terminal', body: rest })
      }
      case '777': {
        // urxvt: "777;notify;<title>;<body>"
        const [sub, title = '', body = ''] = rest.split(';')
        if (sub === 'notify') return this.notify(paneId, { title, body })
        return // some other 777 sub-command — not ours
      }
      case '99': {
        // kitty: "99;<metadata>;<body>". v1: ignore metadata, take the body.
        const semi2 = rest.indexOf(';')
        const body = semi2 === -1 ? rest : rest.slice(semi2 + 1)
        return this.notify(paneId, { title: 'Terminal', body })
      }
      default:
        return // OSC 0/2 (title), 8 (hyperlink), 52 (clipboard)… not ours; ignore
    }
  }

  private notify(paneId: string, n: { title: string; body: string }) {
    const wsId = workspaceIdForPane(paneId) // pane → surface → workspace (Ch. 9/10)
    if (!wsId) return
    markWorkspaceAttention(wsId, { title: n.title, body: n.body, source: 'osc' })
  }
}

export const oscScanner = new OscScanner()
```

Let's walk the split example through it to prove it holds:

```
 buffers[pane1] starts: undefined → ""

 push(pane1, "...ok\r\n\x1b]9;Tests")
   buf = "...ok\r\n\x1b]9;Tests"
   indexOf("\x1b]") → found; slice → buf = "\x1b]9;Tests"
   bel = -1, st = -1 → end = -1 → PARTIAL (len < 4096) → KEEP, break
   buffers[pane1] = "\x1b]9;Tests"                          ← retained tail ✅

 push(pane1, " passed\x07$ ")
   buf = "\x1b]9;Tests" + " passed\x07$ " = "\x1b]9;Tests passed\x07$ "
   indexOf("\x1b]") → 0; slice → unchanged
   bel = index of "\x07" → found; end there, termLen = 1
   payload = buf.slice(2, end) = "9;Tests passed"
   handleOsc → code "9", rest "Tests passed" → notify(body="Tests passed") ✅
   buf = "$ " → next loop: no "\x1b]" → discard → buf = ""
   buffers[pane1] = ""
```

**One notification recovered cleanly from two ragged chunks — and xterm.js received
both raw chunks verbatim and rendered them, ignoring the OSC 9 bytes.** No corruption
on either side. This buffer-and-scan loop is to Chapter 12 what the buffer-and-split
loop was to Chapter 11: the load-bearing beam.

> **⚠️ Gotcha — cap the buffer, or binary output DoSes you.** If a program dumps
> binary data containing a stray `\x1b]` with no terminator (running `cat` on an
> image, say), the "partial sequence" branch would keep that byte forever and the
> buffer would grow with every chunk. The `MAX_OSC_LEN` cap (4 KB — far larger than
> any real notification) discards obviously-not-an-OSC junk. Without it, one weird
> `cat` slowly eats memory for that pane's whole lifetime.

> **⚠️ Gotcha — kitty chunking is out of scope for v1.** kitty's OSC 99 can split
> _one_ logical notification across _several_ OSC 99 escapes (using `d=0`/`d=1`
> "done" flags in the metadata) for long or base64-encoded payloads. Our parser
> treats each OSC 99 as one complete notification. That's fine for the short "Build
> done"-style messages agents actually send; just know it's a deliberate simplification,
> not a bug to be surprised by later.

---

## 12.7 The reunion point: `markWorkspaceAttention`

Both doorbells now ring the same bell. Whether a notification came from the socket
(`notification.create`, Chapter 11) or the OSC scanner (§12.6), it arrives at **one
main-process function** with a normalized payload. This is the funnel:

```ts
// main/attention.ts
import { workspaceStore } from './store'
import { broadcastWorkspace } from './ipcBridge' // Chapter 11 §11.8
import { fireDesktopNotification } from './desktopNotify'

export type AttentionPayload = {
  title: string
  body: string
  color?: 'green' | 'yellow' | 'red' | string // §12.9 color convention
  source: 'osc' | 'socket' // for debugging/telemetry only
}

export function markWorkspaceAttention(wsId: string, payload: AttentionPayload) {
  const ws = workspaceStore.get(wsId)
  if (!ws) return

  // 1) Mutate the SINGLE SOURCE OF TRUTH: the main-process Workspace store.
  ws.attention = true // → drives the pane RING + sidebar FLASH
  ws.unread = true // → drives the unread BADGE
  ws.notifications.push({
    // → feeds the notification PANEL
    id: `n_${Date.now()}`,
    title: payload.title,
    body: payload.body,
    color: payload.color,
    ts: Date.now()
  })

  // 2) Push the fresh snapshot to the renderer over IPC (Chapter 11 §11.8).
  broadcastWorkspace(ws) // webContents.send('workspace:update', ws)

  // 3) Fire an OS desktop toast — but DEBOUNCED so we don't spam (§12.10).
  fireDesktopNotification(ws, payload)
}
```

Three steps, and they map one-to-one onto three parts of the UI:

- **`ws.attention = true`** → the pane grows a **ring** and the sidebar row
  **flashes** (§12.9).
- **`ws.unread = true`** → an **unread badge** appears on the row (§12.9).
- **`ws.notifications.push(...)`** → the item shows up in the **notification panel**
  and becomes the target of **jump-to-latest-unread** (§12.9).
- **`broadcastWorkspace(ws)`** → the exact IPC handoff from Chapter 11: the renderer
  gets the whole updated `Workspace` object and re-renders (the renderer is a dumb
  mirror of the store).
- **`fireDesktopNotification(...)`** → the OS-level toast (§12.10).

Notice what's _not_ here: no CSS, no React, no escape-code knowledge. The funnel only
touches **state** and delegates the rest. That's why adding OSC detection didn't
require touching any visual code — Channel ② just learned to call this function.

### The renderer side: a `markAttention` reducer

On the renderer, incoming `workspace:update` snapshots fold into React state. Because
attention has a clear lifecycle — **set** when a notification arrives, **cleared**
when you focus the workspace — it's a textbook `useReducer` (Chapter 8):

```ts
// renderer/state/workspacesReducer.ts
type WsState = Record<string, Workspace> // keyed by id

type Action =
  | { type: 'sync'; ws: Workspace } // a workspace:update snapshot
  | { type: 'clearAttention'; wsId: string } // user focused the workspace

export function workspacesReducer(state: WsState, action: Action): WsState {
  switch (action.type) {
    case 'sync': {
      // Main is the source of truth; trust its attention/unread flags verbatim.
      return { ...state, [action.ws.id]: action.ws }
    }
    case 'clearAttention': {
      // The user looked at it → stop ringing/flashing and mark it read.
      const ws = state[action.wsId]
      if (!ws || (!ws.attention && !ws.unread)) return state // no-op guard
      return { ...state, [action.wsId]: { ...ws, attention: false, unread: false } }
    }
    default:
      return state
  }
}
```

Wiring it up: subscribe to `workspace:update` (dispatch `sync`), and dispatch
`clearAttention` when a row is focused — _and_ tell main to clear its copy too, so the
next restart doesn't resurrect a stale ring (Chapter 13, session persistence):

```ts
// renderer/hooks/useWorkspaces.ts
const [workspaces, dispatch] = useReducer(workspacesReducer, {})

useEffect(() => {
  return window.api.onWorkspaceUpdate((ws) => dispatch({ type: 'sync', ws }))
}, [])

function focusWorkspace(wsId: string) {
  dispatch({ type: 'clearAttention', wsId }) // instant UI feedback
  window.api.selectWorkspace(wsId) // → main clears ws.attention too
}
```

> **⚠️ Gotcha — clear the attention, or the ring never stops.** Setting attention is
> the easy half everyone remembers. The half people forget: **something must turn it
> off.** If focusing a workspace doesn't clear `attention`/`unread`, every pane you've
> ever been pinged on rings forever and the whole sidebar becomes a disco. The rule of
> thumb: **attention is set by the pipeline, cleared by the user looking at it.**

---

## 12.8 The visual payoff: rings, flashes, badges

Now the fun part: turning `ws.attention` and `ws.unread` into Shepherd's visual
attention language. It is driven by two boolean flags plus an optional color, so
the CSS is refreshingly simple. Four visual elements:

```
   SIDEBAR (renderer)                          THE TILED PANES (renderer)
   ┌───────────────────────────┐               ┌──────────────┬──────────────┐
   │  ● api-server        [2] ◄─┼─ unread badge │              │╔════════════╗│
   │    Claude is waiting…  ◄───┼─ status line  │   pane A      │║  pane B    ║│◄─ pulsing
   │ ┌─────────────────────┐    │               │  (calm)       │║ (attention)║│   RING
   │ │ web-frontend    ⚡  ◄┼────┼─ FLASHING row │              │╚════════════╝│
   │ │  Tests passed        │   │               └──────────────┴──────────────┘
   │ └─────────────────────┘    │
   │    docs-site               │               ┌───────────── notification panel ──┐
   └───────────────────────────┘               │ 12:04  web-frontend  Tests passed  │
                                                │ 12:01  api-server    waiting…      │
      ▲ active-highlight (Ch. 10)               └────────────────────────────────────┘
```

### The pane ring (a CSS `@keyframes` pulse)

The ring is a **pulsing box-shadow** — an expanding halo that fades, then repeats.
`box-shadow` is perfect because it draws _outside_ the element's box, so it never
shifts the terminal's layout (unlike `border`, which would nudge everything a pixel):

```css
/* renderer/styles/attention.css */

/* the ring color is a CSS variable so status can recolor it (green/yellow/red) */
.pane {
  --ring-color: 234 179 8; /* yellow (waiting) — space-separated RGB for rgb() alpha */
}
.pane[data-status='done'] {
  --ring-color: 34 197 94;
} /* green */
.pane[data-status='waiting'] {
  --ring-color: 234 179 8;
} /* yellow */
.pane[data-status='error'] {
  --ring-color: 239 68 68;
} /* red */

@keyframes cmux-ring-pulse {
  0% {
    box-shadow: 0 0 0 0 rgb(var(--ring-color) / 0.7);
  } /* tight, bright */
  70% {
    box-shadow: 0 0 0 8px rgb(var(--ring-color) / 0);
  } /* expanded, gone */
  100% {
    box-shadow: 0 0 0 0 rgb(var(--ring-color) / 0);
  } /* reset */
}

/* the class React toggles from ws.attention */
.pane.attention {
  border-radius: 6px;
  animation: cmux-ring-pulse 1.4s ease-out infinite;
}
```

```tsx
// the pane wrapper reads the two pieces of state
<div
  className={`pane ${ws.attention ? 'attention' : ''}`}
  data-status={
    ws.status.at(-1)?.color === 'green'
      ? 'done'
      : ws.status.at(-1)?.color === 'red'
        ? 'error'
        : 'waiting'
  }
>
  <XtermPane paneId={pane.id} />
</div>
```

Toggle one class, and the halo appears and pulses; remove it (on focus, §12.7), and it
vanishes. No JS animation loop, no `requestAnimationFrame` — the browser's compositor
does it all.

### The flashing / highlighted sidebar row

The row does a **brief flash** to catch your eye, then settles into a **steady
highlight** until read (a forever-flashing row is obnoxious — flash to grab attention,
then hold):

```css
@keyframes cmux-row-flash {
  0%,
  100% {
    background: transparent;
  }
  50% {
    background: rgb(var(--ring-color) / 0.18);
  }
}
.workspace-row.attention {
  /* flash 3 times (~1.5s) then STOP — the steady highlight below takes over */
  animation: cmux-row-flash 0.5s ease-in-out 3;
}
.workspace-row.unread {
  background: rgb(var(--ring-color) / 0.1); /* steady, quiet highlight until read */
  font-weight: 600;
}
.workspace-row.unread .badge {
  display: inline-flex;
} /* reveal the count badge */
```

### The unread badge and notification panel

The **badge** is just a count of unread notifications on that row (`ws.notifications`
filtered, or a simpler unread counter). The **notification panel** is an ordinary
React list rendered from every workspace's `notifications`, newest first:

```tsx
function NotificationPanel({ workspaces }: { workspaces: Workspace[] }) {
  const items = workspaces
    .flatMap((ws) => ws.notifications.map((n) => ({ ...n, ws })))
    .sort((a, b) => b.ts - a.ts) // newest first

  return (
    <ul className="notif-panel">
      {items.map((n) => (
        <li key={n.id} className="notif" onClick={() => focusWorkspace(n.ws.id)}>
          <time>{new Date(n.ts).toLocaleTimeString()}</time>
          <span className="notif-ws">{n.ws.name}</span>
          <span className="notif-body">{n.body}</span>
        </li>
      ))}
    </ul>
  )
}
```

### Jump-to-latest-unread

A keyboard shortcut that focuses the workspace with the **most recent unread**
notification — so a single keypress takes you straight to whoever pinged you last.
It's pure derived state:

```ts
function jumpToLatestUnread(workspaces: Workspace[]) {
  const target = workspaces
    .filter((ws) => ws.unread)
    .map((ws) => ({ ws, latest: ws.notifications.at(-1)?.ts ?? 0 }))
    .sort((a, b) => b.latest - a.latest)[0]?.ws // most recent ping wins
  if (target) focusWorkspace(target.id) // focus → clears its attention (§12.7)
}
```

Bind it (Chapter 8's keymap) to something like `Ctrl+Shift+J`, and the multi-agent
workflow from Chapter 1 finally closes the loop: start three agents, look away, hear
the chime, hit one key, land on the exact workspace that needs you.

### The color convention

`FEATURES.md` Part 4 pins down the palette, and it's driven end-to-end by the
`--color` you already plumbed through `set-status`/`notify` in Chapter 11:

| Color         | Convention                      | Set by                                             |
| ------------- | ------------------------------- | -------------------------------------------------- |
| 🟢 **green**  | done / success                  | `shepherd set-status build passing --color green`  |
| 🟡 **yellow** | waiting for input (the default) | `shepherd notify …` (no color) or `--color yellow` |
| 🔴 **red**    | error / needs intervention      | `shepherd set-status build failing --color red`    |

The `color` field rides the socket message → the store → the `workspace:update`
snapshot → the `data-status` attribute → the `--ring-color` variable → the _same_
keyframes recolor themselves. One value, set once by the agent, tints the ring, the
flash, and the badge in unison. **That's why the color lives on the data, not in the
CSS** — the agent decides the meaning; the CSS just renders it.

---

## 12.9 Firing the OS desktop toast (Electron's `Notification`)

The in-app ring is great when you're _looking_ at cmux. But the whole point is that
you've **looked away** — you're in a browser, another window, another workspace. For
that, we need a real **OS desktop notification** (a "toast" in the corner of your
screen, routed through your Linux desktop's notification server via libnotify).

Electron gives us this in the _main_ process with the **`Notification`** class — one
more reason we detect OSC codes in main (§12.5):

```ts
// main/desktopNotify.ts
import { Notification } from 'electron'
import { focusWorkspaceWindow } from './windows'

// --- debounce state: at most one toast per workspace per window of time ---
const lastToastAt = new Map<string, number>()
const DEBOUNCE_MS = 3000

export function fireDesktopNotification(ws: Workspace, payload: AttentionPayload) {
  if (!Notification.isSupported()) return // headless/CI or no notif server

  // --- spam guard (see the gotcha) ---
  const now = Date.now()
  if (now - (lastToastAt.get(ws.id) ?? 0) < DEBOUNCE_MS) return
  lastToastAt.set(ws.id, now)

  const toast = new Notification({
    title: payload.title || ws.name,
    body: payload.body || 'needs your attention',
    urgency: payload.color === 'red' ? 'critical' : 'normal', // Linux-only field
    silent: false
  })

  // Clicking the toast jumps you to the workspace — the OS-level "jump to unread".
  toast.on('click', () => focusWorkspaceWindow(ws.id))

  toast.show()
}
```

A few Linux-specific notes:

- **`urgency`** (`'low' | 'normal' | 'critical'`) is a Linux-only option that maps to
  the freedesktop notification hint. `'critical'` notifications typically **don't
  auto-dismiss** — perfect for a red/error ping you must not miss.
- **`toast.on('click', …)`** lets the toast double as a jump-to-workspace button:
  click it and we focus the right window/workspace (which then clears attention,
  §12.7). This is the OS-level twin of §12.8's in-app jump.
- On Linux, notifications need a running notification server (every mainstream desktop
  — GNOME, KDE, etc. — ships one). `Notification.isSupported()` guards the rare case
  it's absent (headless CI), so the app never crashes trying to toast.

> **⚠️ Gotcha — notification spam, the feature-killer.** An agent stuck in a retry
> loop, a chatty build tool, or a `for` loop with `printf '\e]9;tick\a'` can emit a
> notification **many times a second.** Without a guard, your desktop drowns in
> toasts and users disable notifications entirely — which kills the one feature the
> whole app is _for._ The `DEBOUNCE_MS` window above coalesces bursts: the **OS
> toast** fires at most once per workspace per 3 seconds. Note we debounce **only the
> toast** — the in-app state (`ws.unread`, the notification panel) can still record
> every event, because updating React state is cheap and non-intrusive; it's the
> _interruptive_ OS toast we rate-limit. Choose _what_ to debounce by how disruptive
> it is.

---

## 12.10 End-to-end worked example: a bare `printf` lights up the sidebar

Let's trace the **automatic** channel end-to-end — no agent, no `shepherd` CLI, just a
shell command — to prove Channel ② stands on its own. This is the payoff of the whole
chapter.

**Setup:** a pane exists for workspace `ws_42`; its shell was spawned by node-pty
(Chapter 6). The user (or a plain `Makefile`) runs, inside that pane:

```bash
printf '\e]9;Build finished\a'
```

**① The shell writes those raw bytes** to its pty. node-pty's `onData` fires in the
main process with (possibly) `data = "\x1b]9;Build finished\x07"` — or split across
two events; the buffer handles either.

**② The tee (§12.5) does two independent things:**

```
  webContents.send('pty-data', {paneId, data})   → xterm.js gets RAW bytes,
                                                    ignores OSC 9, shows nothing extra
  oscScanner.push(paneId, data)                  → detection copy
```

**③ The scanner (§12.6)** appends to `buffers[pane_of_ws_42]`, finds `\x1b]` … `\x07`,
extracts `payload = "9;Build finished"`, and dispatches `handleOsc`.

**④ `handleOsc`** splits `code = "9"`, `rest = "Build finished"`. `rest` doesn't start
with `4;`, so it's a notification, not progress. It calls
`notify(paneId, {title: 'Terminal', body: 'Build finished'})`, which resolves
`paneId → ws_42` and calls the funnel.

**⑤ `markWorkspaceAttention('ws_42', …)` (§12.7)** sets `attention = true`,
`unread = true`, pushes the notification, then `broadcastWorkspace(ws_42)` and
`fireDesktopNotification(...)`.

**⑥ IPC handoff (Chapter 11 §11.8):** `webContents.send('workspace:update', ws_42)`.

**⑦ The renderer** dispatches `{type:'sync', ws: ws_42}`; `ws_42`'s row **flashes**,
its pane grows a **pulsing ring**, an **unread badge** appears, and the item lands in
the **notification panel**.

**⑧ In parallel,** Electron's `Notification` fires an **OS desktop toast** —
"Terminal: Build finished" — in the screen corner. Clicking it focuses `ws_42`.

```
 pane shell ──① printf '\e]9;Build finished\a'
    │
    ▼ node-pty onData (MAIN)  ─────────────────────────► ② webContents.send('pty-data')
 tee (§12.5) ──② oscScanner.push(paneId, data)              → xterm.js paints, ignores OSC 9
    │
    ▼ ③ buffer → find "\x1b]"…"\x07" → payload "9;Build finished"
 scanner    ──④ handleOsc: code 9, not "4;" → notify(body="Build finished")
    │
    ▼ ⑤ markWorkspaceAttention('ws_42', …)   ── mutate store (attention/unread/notifications)
    │        ├──⑥ webContents.send('workspace:update', ws_42) ──► ⑦ React: ring + flash + badge + panel 🎉
    │        └──⑧ new Notification({...}).show()               ──►    OS desktop toast (click → focus ws_42)
```

Compare this to §11.10's trace of `shepherd set-status`: **the last four steps are
identical.** Different doorbell (a `printf` escape code instead of a socket call),
same bell (`markWorkspaceAttention` → IPC → React + toast). That convergence is the
entire architectural point of the chapter.

---

## 12.11 Gotchas, gathered

For when you're debugging at 2am, every trap from this chapter in one place:

**1. A `data` event is not a message — buffer and scan.** An OSC sequence can be split
across two `pty.onData` chunks (or arrive glued to the next line of output). Never run
a regex per-chunk; accumulate per-pane and retain the unterminated tail (§12.6). Same
lesson as Chapter 11's socket framing.

**2. Accept both terminators.** OSC ends with **BEL (`\x07`)** _or_ **ST (`\x1b\\`)**.
Handle only one and you'll silently miss every notification from terminals that use
the other (kitty loves ST). (§12.4, §12.6.)

**3. Observe, never consume.** Forward the **raw** `data` to xterm.js untouched; scan
a _copy_. Editing the stream desyncs the terminal's parser (garbled colors, wrong
cursor, dropped UTF-8) and can break OSCs xterm.js legitimately wants (title,
hyperlinks). (§12.5.)

**4. Never forward the scanner's buffer.** The accumulator is a private detection
structure. Send it to the renderer by mistake and you **duplicate bytes** already
forwarded → visible garbage. The renderer only ever receives the untouched `data`
argument. (§12.5.)

**5. Cap the buffer.** A stray `\x1b]` in binary output has no terminator and would
grow a per-pane buffer forever. `MAX_OSC_LEN` (a few KB) discards non-OSC junk.
(§12.6.)

**6. OSC 9 is overloaded.** `9;<text>` is an iTerm _notification_; `9;4;…` is a ConEmu
_progress_ update. Peek at the payload before routing. (§12.4, §12.6.)

**7. Clear attention on focus, or it rings forever.** The pipeline _sets_
`attention`/`unread`; the user _looking at_ the workspace must clear them, in the
renderer **and** in the main store (so a restart doesn't resurrect it). (§12.7.)

**8. Debounce the desktop toast.** A retry loop or chatty tool can emit dozens of
notifications a second. Rate-limit the _interruptive_ OS toast (per workspace), even
if you still record every event in-app. Un-debounced toasts make users disable
notifications — killing the app's headline feature. (§12.10.)

---

## 🧪 Checkpoint

Answer these before moving on (everything's in this chapter):

1. Name the **two input channels** that both end in a lit-up workspace. Which one
   requires the program to know about cmux, and which works for _any_ program?
2. Write out the **four parts** of an OSC sequence in byte order, and give the two
   legal terminators (name + bytes).
3. A shell emits `"\x1b]9;4;1;60\x07"`. Is that a notification? What should the parser
   do with it, and how does it tell it apart from an OSC 9 notification?
4. You scan each `pty.onData` chunk with a fresh regex and notifications
   _intermittently_ go missing under load. What's the bug, and what's the fix?
5. Why must the bytes forwarded to xterm.js be **identical** to what the shell emitted?
   Give two concrete things that break if you strip "just the notification codes."
6. Both channels call one function. Name it, and name the three pieces of `Workspace`
   state it mutates and which visual element each one drives.
7. Which Electron API fires the OS desktop toast, and why does it live in the **main**
   process rather than the renderer?
8. An agent stuck in a retry loop emits an OSC 9 fifty times a second. What breaks, and
   what's the fix? Would you debounce the in-app badge too — why or why not?

---

## Summary

A workspace lights up through **two doorbells wired to one bell.** The **explicit**
channel (Chapter 11) is an agent running `shepherd notify` / `set-status` from a hook,
travelling the socket API. The **automatic** channel — this chapter's new material —
is cmux **watching the raw node-pty output** for **OSC escape sequences**: the
byte-level shape `ESC ] <code> ; <payload> <BEL or ST>`, where **OSC 9** (iTerm),
**OSC 777** (urxvt), and **OSC 99** (kitty) mean "post a notification" and **OSC 9;4**
means "progress." We scan the stream in the **main** process with a strict rule —
**observe, don't consume** — teeing the raw bytes to xterm.js untouched while feeding
a _copy_ to a **per-pane buffer** that reassembles sequences **split across `data`
chunks** (the same framing lesson as the socket). Both channels normalize to
`{title, body}` and call **one funnel**, `markWorkspaceAttention(wsId, payload)`,
which mutates `attention` / `unread` / `notifications`, hands off over IPC
(`webContents.send('workspace:update')`), and fires a **debounced** Electron
`Notification` toast. The renderer folds the snapshot through a **reducer** and
renders the payoff: a CSS `@keyframes` **ring** on the pane, a **flashing then steady
row**, an **unread badge**, a **notification panel**, and **jump-to-latest-unread** —
all recolored by one **green/yellow/red** convention the agent sets via `--color`.
Master the buffer-and-scan loop, the observe-don't-consume tee, and the one-funnel
pipeline, and you own the feature that _is_ cmux.

## Where this shows up next

- The `pty.onData` stream we tee and scan → `06-node-pty.md`
- The socket half of the pipeline (`notification.create` / `set-status`, `shepherd hooks setup`) → `11-the-socket-api.md`
- The `webContents.send('workspace:update')` IPC handoff both channels use → `04-ipc-inter-process-communication.md`
- Escape-code fundamentals (ESC, CSI vs OSC) in depth → `02-how-terminals-work.md`
- xterm.js rendering the raw stream (and its own OSC handlers) → `07-xtermjs.md`
- The `useReducer` + hooks pattern behind the attention reducer → `08-react-in-this-app.md`
- The `Workspace.attention` / `unread` / `notifications` fields we mutate → `09-typescript-and-the-data-model.md`
- Persisting (and correctly clearing) unread state across relaunch → `13-session-persistence.md`
- The full keystroke-and-notification synthesis, end to end → `17-how-it-all-connects.md`

## Further reading

- XTerm control sequences — the canonical OSC reference: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
- iTerm2 proprietary escape codes (OSC 9 / 1337): https://iterm2.com/documentation-escape-codes.html
- kitty desktop notification protocol (OSC 99): https://sw.kovidgoyal.net/kitty/desktop-notifications/
- ConEmu / Windows Terminal progress (OSC 9;4): https://conemu.github.io/en/AnsiEscapeCodes.html
- Electron `Notification` API and tutorial: https://www.electronjs.org/docs/latest/api/notification
- xterm.js parser hooks (`registerOscHandler`, the renderer-side alternative): https://xtermjs.org/docs/api/terminal/interfaces/iparser/
- Our `FEATURES.md` Part 4 (notification & status mechanics) and `ROADMAP.md` M4 (build order)
