# Chapter 7 — xterm.js: Drawing the Terminal

> **What you'll learn**
> - What xterm.js is: a terminal emulator that renders in the DOM (VS Code's engine)
> - The crucial truth: it does **not** run a shell — it only paints bytes and emits keystrokes
> - The core API: `new Terminal(opts)`, `open(div)`, `write(data)`, `onData(cb)`, `onResize`
> - The addons that matter: **FitAddon**, **WebglAddon**, **SearchAddon**, **WebLinksAddon**
> - Theming with the `theme` object — background, foreground, cursor, and the 16 ANSI colors
> - Mounting a Terminal inside a React component with a `ref` + `useEffect`, and disposing it
> - The **resize dance**: `FitAddon.fit()` → cols/rows → node-pty (Chapter 6)
> - Performance: WebGL, the scrollback buffer, and why terminal updates must **not** flow through React re-renders
> - A worked `TerminalPane` skeleton wiring `window.api.onPtyData` / `sendInput`
>
> **Prerequisites:** Chapter 2 (`02-how-terminals-work.md`) for escape codes and
> what a terminal *shows*; Chapter 6 (`06-node-pty.md`) for the real shell whose
> bytes we're about to draw. This chapter lives entirely in the **renderer** — the
> React frontend.

---

## 7.1 What xterm.js is

**xterm.js** is a terminal emulator written in TypeScript that draws a fully
functional terminal **inside a web page**. Give it a `<div>` and it fills it with
a grid of character cells, a blinking cursor, scrollback, text selection, colors,
and everything else you expect from a terminal — all rendered with normal web
technology (the DOM, `<canvas>`, or WebGL).

It is not a toy. **xterm.js is the exact engine that powers the integrated
terminal in Visual Studio Code.** Every time you've used the terminal panel in VS
Code, you were using xterm.js. It's battle-tested against real shells, real
`vim`, real `tmux`, real color-heavy program output — which is precisely why we
choose it: recreating a terminal renderer from scratch would be a multi-year
project, and this one is already excellent and free.

> **🔧 In cmux-linux:** xterm.js is the "GPU terminal" box in the Chapter 1
> architecture diagram. The real cmux is built on Ghostty's GPU renderer; we can't
> use that (it's a Zig/C library — see `FEATURES.md` #29), so xterm.js **plus its
> WebGL addon** (§7.4) is our closest equivalent: a genuinely fast,
> GPU-accelerated terminal that runs in a Chromium window. It's item #27 on the
> parity map, marked "🟢-ish" for exactly this reason.

> **⚠️ Naming note:** the modern package is `@xterm/xterm` (v5+), and its addons
> are `@xterm/addon-fit`, `@xterm/addon-webgl`, and so on. Older tutorials import
> the bare `xterm` / `xterm-addon-*` names — that's the pre-v5 layout. We use the
> `@xterm/*` scoped packages throughout.

---

## 7.2 The crucial distinction: xterm.js does NOT run a shell

This is the most important paragraph in the chapter, and the one that
consistently confuses people coming from "I typed in a terminal and it worked, so
the terminal must *be* the shell."

**xterm.js has no shell inside it. It cannot run a command. It has never heard of
bash.** It does exactly two things:

1. **It renders bytes you hand it.** You call `term.write("\x1b[32mhello\x1b[0m")`
   and it paints a green "hello". Where did those bytes come from? xterm.js
   neither knows nor cares. They could be from a real shell, from a file, or from
   `term.write("just a test")` you typed in your own code. It's a **display**.
2. **It emits the keystrokes you type into it.** When the terminal has focus and
   you press a key, xterm.js figures out the correct bytes a real terminal would
   send for that key (including the tricky ones — arrows, `Ctrl-C`, function keys)
   and fires its `onData` event with them. It does **not** act on them. It just
   reports "the user typed these bytes; do with them what you will."

So xterm.js is a **puppet with no puppeteer of its own**. It shows whatever
you paint and reports whatever you type — and *something else* has to be the
brain that connects the two. In cmux-linux, that brain is the round-trip through
IPC to node-pty. Put the two chapters side by side:

```
   node-pty  (main process, Chapter 6)        xterm.js  (renderer, this chapter)
   ────────────────────────────────           ──────────────────────────────────
   • IS the real shell (bash)                  • IS a picture of a terminal
   • pty.onData → the shell's OUTPUT           • term.write(data) → PAINT that output
   • pty.write(data) → send INPUT to shell     • term.onData → EMIT what the user typed
   • runs commands, has a PID                   • runs nothing, has no PID
   • no pixels, ever                            • all pixels, no logic

        ┌──────────────────── the same wire ────────────────────┐
        │                                                        │
   pty.onData(data) ──IPC──► term.write(data)     (output: shell → picture)
   term.onData(data) ──IPC──► pty.write(data)     (input:  picture → shell)
```

Read that diagram until it's obvious. **node-pty is the real shell; xterm.js is
the picture of it.** They are opposite ends of one wire, and neither does the
other's job. Chapter 1's headline gotcha was this exact mix-up; here's where it
resolves.

> **⚠️ Gotcha:** because xterm.js emits keystrokes but doesn't act on them, a
> Terminal wired to *nothing* looks broken in a very specific way: you type and
> **nothing appears** — not even the letters you pressed. That's not a bug, it's
> the design. A real terminal doesn't show your keystrokes either; the **shell**
> echoes them back as output. If characters don't appear as you type, your
> `onData → pty.write → pty.onData → term.write` loop is broken somewhere, not
> xterm.js. (A quick sanity check while building: temporarily do
> `term.onData(d => term.write(d))` to echo locally and confirm rendering works.)

---

## 7.3 The core API

Four calls carry ninety percent of the work. Here is the smallest complete
example — a terminal that echoes what you type, with no shell involved at all:

```ts
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';         // xterm ships its own stylesheet — load it

const term = new Terminal({                   // (1) create
  cols: 80,
  rows: 24,
  cursorBlink: true,
  fontFamily: 'monospace',
  fontSize: 14,
});

term.open(document.getElementById('terminal')!);  // (2) mount into a DOM element

term.write('Welcome to xterm.js\r\n$ ');           // (3) paint some bytes

term.onData((data) => {                            // (4) capture keystrokes
  term.write(data);                                //     here we just echo them back
});
```

**(1) `new Terminal(options)`** — constructs the emulator. `options` is a big bag
of settings; the ones you touch most:

| Option | What it controls | Default |
|---|---|---|
| `cols` / `rows` | initial size in character cells | 80 × 24 |
| `cursorBlink` | does the cursor blink | `false` |
| `cursorStyle` | `'block'` \| `'underline'` \| `'bar'` | `'block'` |
| `fontFamily` | the monospace font | `'courier-new, courier, monospace'` |
| `fontSize` | font size in px (drives cell size) | `15` |
| `lineHeight` | line-height multiplier | `1.0` |
| `scrollback` | lines of history kept above the top (§7.8) | `1000` |
| `convertEol` | translate a lone `\n` into `\r\n` | `false` |
| `theme` | the color scheme object (§7.5) | xterm's default |
| `allowProposedApi` | opt into experimental APIs some addons need | `false` |

**(2) `term.open(container)`** — attaches the terminal to a real DOM node,
building its internal elements inside that container. Nothing is visible until you
call this. (There's a subtle but important rule about *when* the container must
have a size — §7.6's gotcha.)

**(3) `term.write(data)`** — the paint call. `data` is a string (or `Uint8Array`)
of terminal bytes, escape codes and all. This is the single method that puts
anything on screen. In cmux-linux, essentially every `write` call's argument comes
straight from node-pty's `onData` over IPC. There's also `term.writeln(data)`
(write + newline) for convenience.

**(4) `term.onData(callback)`** — fires whenever the user produces input, with the
encoded bytes. This is the keystroke source. Note the name collides with
node-pty's `onData` but means the opposite direction: node-pty's `onData` is the
shell's *output*; xterm's `onData` is the user's *input*. (Keep them straight: in
the renderer, `onData` = "user typed"; in main, `onData` = "shell printed.")

**`term.onResize(callback)`** — fires when the terminal's dimensions change (for
example, after `FitAddon.fit()` recomputes them). The callback gets `{ cols, rows
}`. This is the event we forward to node-pty so the real shell learns the new size
(§7.7).

> **🔧 In cmux-linux:** map these four onto the loops from Chapter 1.
> `term.write(data)` is the *renderer* end of **Loop B** (paint the shell's
> output). `term.onData(data)` is the *renderer* start of **Loop A** (the user
> typed something). `term.onResize` kicks off the resize dance. The Terminal
> object is where all three of the app's heartbeat loops surface in the UI.

---

## 7.4 The addons that matter

xterm.js keeps its core small and ships extra capabilities as **addons** —
separate packages you instantiate and register with `term.loadAddon(instance)`.
Four are relevant to us.

```ts
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';

const fit = new FitAddon();
term.loadAddon(fit);                 // must load before you call fit()
term.open(container);

term.loadAddon(new WebglAddon());    // GPU rendering (load AFTER open())
term.loadAddon(new SearchAddon());
term.loadAddon(new WebLinksAddon()); // makes URLs clickable

fit.fit();                           // size the terminal to its container
```

**FitAddon — size the terminal to its container.** By itself, a Terminal is a
fixed `cols × rows` grid; it has no idea how big its `<div>` is. FitAddon measures
the container's pixel size, divides by the size of one character cell, and calls
`term.resize(cols, rows)` with however many cells fit. You call `fit.fit()`
after mounting and again on every layout change. This is *the* addon that connects
"pixels on screen" to "character grid," and it's the first half of the resize
dance (§7.7). It also offers `fit.proposeDimensions()` to compute `{cols, rows}`
without applying them, if you want to inspect the numbers.

**WebglAddon — GPU rendering.** By default (v5+), xterm.js renders with the
**DOM renderer**: fast enough for light use, but it can stutter on heavy output
(think an agent streaming thousands of lines, or a fast `cat` of a big file) and
on smooth scrolling. The WebGL addon moves rendering onto the GPU via WebGL2,
drawing the whole grid as textured quads. The result is dramatically smoother
scrolling and high-throughput output — **our closest thing to cmux's Ghostty GPU
renderer.**

> **⚠️ Gotcha — WebGL context loss.** A browser can *revoke* a WebGL context at
> any time: the GPU driver resets, the machine sleeps, too many contexts are open,
> the tab is backgrounded. When that happens the addon emits `onContextLoss` and
> then renders **nothing** until handled. You must listen and recover — the simple,
> robust move is to dispose the addon (which falls back to the DOM renderer) or
> re-create it:
>
> ```ts
> const webgl = new WebglAddon();
> webgl.onContextLoss(() => { webgl.dispose(); }); // fall back to DOM renderer
> term.loadAddon(webgl);
> ```
>
> Skip this and users will occasionally hit a **blank black terminal** that "fixes
> itself if I resize" — a classic unhandled-context-loss symptom.

**SearchAddon — find in the buffer.** Adds `findNext(term)` / `findPrevious(term)`
to search the scrollback, with options for case sensitivity, whole-word, and regex,
plus highlight decorations. We'll wire this to a Ctrl-F search box later.

**WebLinksAddon — clickable URLs.** Detects `http(s)://…` in the output and turns
it into a clickable link that opens in the browser. Small, high-value polish for
an agent tool that constantly prints URLs (PRs, docs, dev servers).

| Addon | Package | One-line job |
|---|---|---|
| **FitAddon** | `@xterm/addon-fit` | measure the container → set cols/rows |
| **WebglAddon** | `@xterm/addon-webgl` | GPU-accelerated rendering (smooth, fast) |
| **SearchAddon** | `@xterm/addon-search` | find text in the scrollback |
| **WebLinksAddon** | `@xterm/addon-web-links` | make URLs clickable |

> **🔧 In cmux-linux:** FitAddon and WebglAddon are **not optional** for us —
> FitAddon because our panes resize constantly (splits, drags, sidebar toggles),
> and WebglAddon because agents produce heavy, colorful, streaming output that the
> DOM renderer struggles with. Search and WebLinks are polish we add in the M6
> theming/perf pass (`ROADMAP.md`). Load order matters: **FitAddon before
> `fit()`**, and **WebglAddon after `open()`** (it needs the mounted canvas).

---

## 7.5 Theming: matching cmux's dark look

xterm.js's colors come from a `theme` object — either passed in the constructor
or set later via `term.options.theme = {…}`. It defines the UI colors (background,
foreground, cursor, selection) **and** the 16 ANSI colors that Chapter 2's escape
codes (`\x1b[31m` = red, `\x1b[42m` = green background, …) actually resolve to.

```ts
const cmuxDark = {
  background: '#0d1117',        // the terminal's backdrop
  foreground: '#c9d1d9',        // default text color
  cursor:     '#58a6ff',        // the cursor block
  cursorAccent: '#0d1117',      // text drawn *under* a block cursor
  selectionBackground: '#264f78',

  // the 16 ANSI colors — this is what `\x1b[31m` (red) etc. map to:
  black:   '#484f58', red:     '#ff7b72', green:   '#3fb950', yellow: '#d29922',
  blue:    '#58a6ff', magenta: '#bc8cff', cyan:    '#39c5cf', white:  '#b1bac4',
  brightBlack:  '#6e7681', brightRed:     '#ffa198', brightGreen:  '#56d364',
  brightYellow: '#e3b341', brightBlue:    '#79c0ff', brightMagenta:'#d2a8ff',
  brightCyan:   '#56d4dd', brightWhite:   '#f0f6fc',
};

const term = new Terminal({ theme: cmuxDark, fontFamily: 'JetBrains Mono, monospace' });
```

How to think about the two groups:

- **The UI colors** (`background`, `foreground`, `cursor`, `cursorAccent`,
  `selectionBackground`) set the terminal's "chrome" and its default text — the
  dark canvas and light default text that give cmux its look.
- **The 16 ANSI colors** (`black`…`white` and their 8 `bright*` variants) are the
  palette a *program's* output draws from. When `ls` prints a directory in blue or
  an agent prints an error in red, the actual pixel color is whatever your theme
  maps `blue` / `red` to. This is why two terminals running the same command can
  look completely different: same escape codes, different palette.

> **🔧 In cmux-linux:** the terminal theme is one half of our dark look; the
> React chrome around it (sidebar, tabs, panes) is styled with CSS variables to
> match (see `REFRESHER.md`'s CSS section and `10-tiling-and-layout.md`). We keep
> a single source of truth — one palette — and feed the same colors to both the
> xterm `theme` object and the CSS custom properties, so the terminal and the app
> around it look like one designed surface, not a terminal glued into a webpage.
> Later (`FEATURES.md` #20) we can even read the user's Ghostty config and map its
> colors into this object for authenticity.

> **⚠️ Gotcha:** update the theme by assigning a *new* object to
> `term.options.theme` (e.g. `term.options.theme = { ...cmuxDark, background:
> '#000' }`), not by mutating the existing one in place — xterm watches for the
> assignment to know it should re-render with the new colors.

---

## 7.6 Mounting a Terminal inside React

xterm.js is an imperative, non-React library: it manages its own DOM subtree and
its own render loop. React's job is *not* to render the terminal's contents —
React's job is to give xterm a `<div>` to live in, create the Terminal at the
right moment, and destroy it at the right moment. The tools for that are exactly
the two hooks from `REFRESHER.md`: **`useRef`** (to hold the div and the Terminal
without triggering re-renders) and **`useEffect`** (to create on mount, dispose on
unmount). The deep React reasoning is Chapter 8's subject (`08-react-in-this-app.md`);
here's the pattern and the *why*.

```tsx
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

function TerminalView() {
  const boxRef  = useRef<HTMLDivElement>(null);      // the div xterm draws into
  const termRef = useRef<Terminal | null>(null);     // the Terminal, kept across renders

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, theme: cmuxDark });
    const fit  = new FitAddon();
    term.loadAddon(fit);
    term.open(boxRef.current!);   // mount into the div (must have size — see gotcha)
    fit.fit();                    // size to the container
    termRef.current = term;

    return () => {
      term.dispose();             // ← CLEANUP: tear down xterm on unmount
      termRef.current = null;
    };
  }, []);                         // [] → run once when this pane mounts

  return <div ref={boxRef} style={{ width: '100%', height: '100%' }} />;
}
```

Three load-bearing decisions:

- **The Terminal lives in a `ref`, not in `useState`.** State changes trigger
  re-renders; a terminal must persist untouched across every re-render of the
  surrounding UI. A ref is a stable box that survives renders without causing
  them — perfect for a long-lived non-React object. (This is the single most
  important React idea for this app, which is why `REFRESHER.md` flags it too.)
- **Creation happens in `useEffect`, not during render.** `term.open()` needs a
  real, mounted DOM node; during render the div doesn't exist yet. `useEffect`
  runs *after* the DOM is painted, so `boxRef.current` is a real element by then.
- **The cleanup function calls `term.dispose()`.** This is not optional.

> **⚠️ Gotcha — you MUST `dispose()`.** A Terminal holds real resources: DOM
> nodes, event listeners, internal buffers, and — if the WebGL addon is loaded —
> an actual **GPU context**. If a pane unmounts and you don't call `term.dispose()`
> in the cleanup, all of that leaks. In an app whose entire point is opening and
> closing many panes, the leak compounds fast: memory climbs, and because browsers
> cap the number of live WebGL contexts (~16), after enough undisposed panes new
> terminals **fail to get a GPU context at all** and silently fall back or break.
> Every `new Terminal()` must be paired with a `term.dispose()` on the teardown
> path — the mirror image of Chapter 6's "every `spawn` needs a `kill`." In fact
> they fire together: closing a pane both `dispose()`s the xterm (renderer) and
> `killPty()`s the shell (main).

> **⚠️ Gotcha — don't `open()` into a zero-size container.** If you call
> `term.open()` / `fit.fit()` while the container `<div>` still has `0` width or
> height (because CSS hasn't laid it out yet, or the pane is inside a collapsed/
> `display:none` region), FitAddon computes a nonsensical size — sometimes a
> 1-column terminal, sometimes it throws. Ensure the container is laid out with a
> real size first. In practice: give the div `width/height: 100%` inside a parent
> that has real dimensions, and if a pane can mount hidden, defer `fit()` until
> it's actually visible (a `ResizeObserver` or an on-show callback). "Why is my
> terminal one character wide?" is almost always this.

---

## 7.7 The resize dance

Resizing a terminal is a two-party handshake between the renderer (which knows the
*pixels*) and the main process (which owns the *shell*). We saw the main-process
half in Chapter 6 (`ptyProcess.resize` → `SIGWINCH` → `vim` redraws). Here's the
renderer half that starts it:

```
┌─ RENDERER (this chapter) ─────────────┐         ┌─ MAIN (Chapter 6) ─────────┐
│ container's pixel size changes         │         │                            │
│   (window resize / split drag /        │         │                            │
│    sidebar toggle)                      │         │                            │
│        │                                │         │                            │
│        ▼                                │         │                            │
│  fit.fit()                              │         │                            │
│    → measures the div                   │         │                            │
│    → term.resize(cols, rows)            │         │                            │
│    → fires term.onResize({cols,rows})   │         │                            │
│        │                                │         │                            │
│        ▼   window.api.resizePty(        │  IPC    │  ptys.get(id)?.resize(     │
│            ptyId, cols, rows)  ─────────┼────────►│      cols, rows)           │
│                                         │         │    → TIOCSWINSZ → SIGWINCH │
│                                         │         │    → vim/htop/less redraw  │
└─────────────────────────────────────────┘         └────────────────────────────┘
```

In code, you connect `onResize` to the IPC call, and call `fit.fit()` whenever the
container changes size. The clean way to know the container changed is a
`ResizeObserver`:

```ts
// inside the same useEffect as the Terminal
term.onResize(({ cols, rows }) => {
  window.api.resizePty(ptyId, cols, rows);   // tell the real shell (Chapter 6)
});

const ro = new ResizeObserver(() => fit.fit());  // re-fit on any container change
ro.observe(boxRef.current!);

return () => {
  ro.disconnect();
  term.dispose();
};
```

The flow: the container changes → `ResizeObserver` fires → `fit.fit()` remeasures
and calls `term.resize` → that fires `term.onResize` → we send the new `{cols,
rows}` to node-pty → the shell (and any full-screen app) learns its new size. Miss
any link and you get the garbled-`vim` symptom from Chapter 6, except the bug is
now on the renderer side (usually: forgot to call `fit()` on resize, or forgot to
forward `onResize` to the pty).

> **🔧 In cmux-linux:** because our panes tile and drag (`10-tiling-and-layout.md`),
> resize isn't a rare window event — it happens constantly as the user rearranges
> splits. Every Terminal pane gets its own `ResizeObserver` so each one re-fits
> independently when its slice of the layout changes. The renderer measures; the
> main process applies. Same division of labor as Chapter 6, viewed from the other
> end.

---

## 7.8 Performance: WebGL, scrollback, and staying out of React's way

Terminals are a performance-sensitive widget: an agent can dump tens of thousands
of bytes per second, and the whole thing must stay smooth. Three ideas keep it
fast.

**WebGL rendering (recap of §7.4).** The WebGL addon is the biggest single lever —
it offloads drawing to the GPU so high-throughput output and scrolling stay at
60fps. Enable it (with context-loss handling) and most performance worries
evaporate.

**The scrollback buffer.** `scrollback` (default **1000** lines) is how much
history xterm keeps above the visible top so you can scroll up. Every retained
line costs memory — a big number times many panes adds up. 1000–5000 is a
reasonable range; don't set it to something enormous "just in case" across dozens
of terminals, and remember each pane pays the cost independently.

**And the one that bites React developers: do NOT drive terminal updates through
React state.** This is the deepest point in the chapter, so slow down for it.

Your instinct as a React developer is "data changes → put it in state → let React
re-render." **For terminal output, that instinct is wrong and will destroy
performance.** Consider what a naïve version looks like:

```tsx
// ❌ NEVER DO THIS
function BadTerminal({ ptyId }) {
  const [output, setOutput] = useState('');
  useEffect(() => window.api.onPtyData(ptyId, chunk =>
    setOutput(prev => prev + chunk)          // state grows on every chunk
  ), [ptyId]);
  return <pre>{output}</pre>;                 // React re-renders the whole thing
}
```

Everything is wrong here. Every chunk of shell output — potentially hundreds per
second — triggers a `setState`, which triggers a React re-render, which re-creates
and re-diffs an ever-growing string. There's no cursor movement, no colors (it's
raw escape codes in a `<pre>`), no scrollback management. It melts under `ls -R /`.

The correct model: **the Terminal is an imperative black box React holds by a ref
and never re-renders.** Output bytes go *straight* into `term.write()`, bypassing
React state entirely. React never sees the terminal's contents; it only owns the
container div's existence.

```tsx
// ✅ THE RIGHT WAY — bytes go straight to term.write, never through React state
useEffect(() => {
  const off = window.api.onPtyData(ptyId, (chunk) => {
    termRef.current?.write(chunk);   // imperative paint — zero re-renders
  });
  return () => off();
}, [ptyId]);
```

xterm.js has its own highly optimized rendering pipeline (batching writes,
diffing cells, drawing via WebGL). Routing bytes through React state would throw
all of that away and replace it with the worst possible renderer. So the rule:

> **⚠️ Gotcha (the big one):** **terminal bytes must never pass through React
> state or props.** React owns *whether a pane exists and where it sits in the
> layout*; xterm.js owns *what's inside it*. The only React state near a terminal
> is coarse structural stuff (which panes exist, which is focused) that changes a
> few times a minute — never the byte stream, which changes hundreds of times a
> second. Keep the Terminal in a `ref`, write to it imperatively, and let it
> manage its own pixels. This single principle is why `08-react-in-this-app.md`
> leans so hard on `useRef`.

```
   React's job                          xterm.js's job
   ──────────────────────────           ────────────────────────────────
   • does this pane exist?              • every character cell + color
   • where is it in the layout?         • the cursor, scrollback, selection
   • is it focused?                     • the 60fps render loop
   • (changes ~/minute → re-render)     • (changes ~/second → NO re-render)
        held in useState                     held in useRef, written imperatively
```

---

## 7.9 The worked example: a `TerminalPane` component

Now assemble everything — creation, addons, theme, the pty output→`write` loop,
the keystroke `onData`→pty loop, the resize dance, and disposal — into the
renderer half of Loops A & B. This is the exact mirror of Chapter 6's §6.11.

```tsx
// renderer/TerminalPane.tsx
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { cmuxDark } from './theme';

export function TerminalPane({ ptyId }: { ptyId: string }) {
  const boxRef  = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    // ── create + configure ────────────────────────────────────────────
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      scrollback: 2000,
      theme: cmuxDark,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(boxRef.current!);       // container must already have a real size
    fit.fit();                        // size to the container

    const webgl = new WebglAddon();   // GPU rendering, with context-loss recovery
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);

    termRef.current = term;

    // ── LOOP B (output): pty → term.write ─────────────────────────────
    const offData = window.api.onPtyData(ptyId, (chunk) => {
      term.write(chunk);              // imperative paint — never via React state
    });

    // ── LOOP A (input): keystrokes → pty.write (over IPC) ─────────────
    const keyDisposable = term.onData((data) => {
      window.api.sendInput(ptyId, data);   // → main → ptyProcess.write(data)
    });

    // ── resize dance: fit on container change → tell the shell ────────
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      window.api.resizePty(ptyId, cols, rows);
    });
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(boxRef.current!);

    // ── if the shell dies, note it in the terminal ────────────────────
    const offExit = window.api.onPtyExit(ptyId, ({ exitCode }) => {
      term.write(`\r\n[process exited with code ${exitCode}]\r\n`);
    });

    // ── CLEANUP: dispose in lockstep with killing the pty ─────────────
    return () => {
      offData();
      offExit();
      keyDisposable.dispose();
      resizeDisposable.dispose();
      ro.disconnect();
      term.dispose();                 // free DOM, buffers, and the GPU context
    };
  }, [ptyId]);

  return <div ref={boxRef} style={{ width: '100%', height: '100%' }} />;
}
```

Trace the loops one more time, now from the renderer side:

**Loop A — you type `l`:** the terminal has focus, you press `l`, xterm fires
`term.onData('l')`, we call `window.api.sendInput(ptyId, 'l')` (preload → IPC →
`ptyProcess.write('l')` in main, Chapter 6). You do *not* see the `l` yet — it's
just been sent to the shell.

**Loop B — the shell echoes it and prints output:** bash receives `l`, echoes it,
node-pty's `onData` fires in main, `webContents.send('pty:data', …)` pushes it
over IPC, our `window.api.onPtyData` handler runs `term.write('l')`, and *now* the
`l` appears. The letter you see was drawn because the **shell** sent it back — not
because you typed it. That's the §7.2 truth made concrete.

**Cleanup:** when this pane closes, React unmounts the component, the `useEffect`
cleanup runs: it unsubscribes the IPC listeners, disposes the xterm event
handlers, disconnects the observer, and calls `term.dispose()` — freeing the GPU
context and everything else. On the main side, the same "close pane" action calls
`killPty(ptyId)`. **Both ends of the wire tear down together**, and nothing leaks.

> **🔧 In cmux-linux:** `window.api.onPtyData`, `sendInput`, `resizePty`, and
> `onPtyExit` are the tidy functions our **preload** exposes on `window.api`
> (`05-preload-and-context-isolation.md`) — the renderer never touches
> `ipcRenderer` or node-pty directly. This component is the whole terminal UI in
> one file; the tiling and tabs around it (`10-tiling-and-layout.md`) just decide
> *how many* `TerminalPane`s exist and *where* they sit. Each one owns exactly one
> shell, mirrored by exactly one entry in the main process's `Map<ptyId, IPty>`.

---

## 🧪 Checkpoint

Answer these before moving on (all answers are in this chapter):

1. In one sentence each: what are the *only two* things xterm.js does, and which
   one is the counterpart to node-pty's `pty.write`?
2. You wire up a Terminal, type into it, and nothing appears — not even the
   letters. Is xterm.js broken? Explain what's actually happening and how to
   confirm rendering works.
3. What does `FitAddon.fit()` compute, and what two calls does the resize dance
   chain it to on the way to `vim` redrawing?
4. Why must the Terminal live in a `useRef` and never in `useState`? What
   specifically goes wrong if terminal output flows through React state?
5. Name the two resources a WebGL-backed Terminal leaks if you forget
   `term.dispose()`, and why the second one eventually breaks *new* terminals.
6. What does the `theme` object's `red` field actually affect — the terminal
   background, or the color that `\x1b[31m` output resolves to?
7. Why is "don't call `open()` before the container has a size" a real gotcha, and
   what's the typical visible symptom?

---

## Summary

**xterm.js** is a DOM-based terminal emulator — VS Code's engine — that **renders
bytes you give it** (`term.write`) and **emits the keystrokes you type**
(`term.onData`), and does *nothing else*: it has no shell, runs no commands, and
is purely the **picture** whose real counterpart is node-pty. You create it with
`new Terminal(options)`, mount it with `open(div)`, size it with the **FitAddon**,
speed it up with the **WebglAddon** (handling context loss), color it with a
**theme** object (background/foreground/cursor + the 16 ANSI colors), and add
**Search**/**WebLinks** for polish. In React it lives in a **`useRef`**, is
created in **`useEffect`**, and — critically — is **disposed on cleanup** in
lockstep with killing its pty. Terminal bytes go **straight to `term.write`**,
never through React state, because React owns *whether a pane exists* while
xterm.js owns *what's inside it*. Wired to node-pty over IPC, `TerminalPane` is the
renderer half of Loops A & B — the front end of the same wire whose back end was
Chapter 6.

## Where this shows up next
- The real shell whose bytes we paint and whose input we send → `06-node-pty.md`
- The `useRef` / `useEffect` / cleanup patterns this leans on, in depth → `08-react-in-this-app.md`
- The `ptyId` and the Terminal-panel type these components are keyed on → `09-typescript-and-the-data-model.md`
- Deciding how many `TerminalPane`s exist and where they tile → `10-tiling-and-layout.md`
- The escape codes we scan the write-stream for (rings/flash) → `12-notifications-and-osc.md`
- Restoring terminals (and their scrollback) after a relaunch → `13-session-persistence.md`
- Bundling `@xterm/*` and its CSS/worker assets → `14-build-tooling-and-vite.md`
- The full keystroke trace, end to end → `17-how-it-all-connects.md`

## Further reading
- xterm.js — homepage and live demo: https://xtermjs.org/
- xterm.js — source and API typings: https://github.com/xtermjs/xterm.js
- FitAddon: https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit
- WebglAddon (and context-loss notes): https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl
- SearchAddon: https://github.com/xtermjs/xterm.js/tree/master/addons/addon-search
- WebLinksAddon: https://github.com/xtermjs/xterm.js/tree/master/addons/addon-web-links
- MDN — `ResizeObserver` (how we re-fit on layout changes): https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
- MDN — handling WebGL context loss: https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost
