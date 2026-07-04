# Chapter 2 — How Terminals Really Work

> **What you'll learn**
> - Why a modern terminal still pretends to be a 1960s teletype, and the three
>   layers that fiction is built from
> - `stdin`/`stdout`/`stderr` as plain byte streams — the same idea as
>   `process.stdin` in Node, but at the OS level
> - The difference between a **terminal** (the screen/keyboard) and a **shell**
>   (bash/zsh) — they are *not* the same thing, and confusing them will hurt
> - The **PTY**: a fake serial cable the kernel builds so a *program* (a terminal
>   emulator) can impersonate hardware for another program (the shell)
> - How raw bytes become **colors, cursor moves, and cleared screens** via
>   ANSI/CSI escape sequences — with `printf` examples you can run right now
> - **OSC** sequences: how a program sets the window title, and (preview) how it
>   fires a desktop notification
> - **Line discipline** — canonical vs raw mode, why your keystrokes appear on
>   screen at all, and why passwords don't
> - Terminal **size** (cols × rows) and the **SIGWINCH** signal that keeps vim
>   from drawing garbage when you resize
>
> **Prerequisites:** Chapter 1 (`01-the-big-picture.md`). You should already know
> that cmux-linux is one Electron app split into a Node **main** process and a
> React **renderer**, that **node-pty** runs the real shell in the backend, and
> that **xterm.js** paints it in the frontend. This chapter is the *physics* under
> those two libraries — the rules of the universe that the rest of the app obeys.

---

## 2.0 Why this chapter is the soul of the app

Here is a promise: everything strange, surprising, or "why is it done *this* way?"
about cmux-linux traces back to facts in this one chapter. Colors made of gibberish
characters. A shell that keeps running when you close the window it was in. A
"terminal" that's really two programs pretending to be a wire. Passwords that
vanish as you type. Notifications that appear because bash printed a magic string.

None of that is Electron, React, or even our code. It's **how terminals have
worked for 50 years**, and our app is a very modern building erected on a very old
foundation. If you understand the foundation, the building makes sense. If you
don't, you'll spend the whole project confused about which library is responsible
for what.

So we go slow here. Read this once carefully and the next dozen chapters get easy.

---

## 2.1 A ghost from 1963: why your terminal thinks it's a teletype

Let's start with a question you've probably never asked: **why is the program on
your Mac/Linux machine called a "terminal," and why does typing `tty` in it print
something like `/dev/pts/3`?**

The answer is a 60-year-old ghost.

**The 1960s — real, physical terminals.** Early computers were expensive
room-sized machines shared by many people. You didn't sit *at* the computer; you
sat at a **terminal** — a separate physical device wired to the computer, often
far away, over a serial cable. The iconic one is the **Teletype Model 33** (the
"TTY" — that abbreviation is where the whole vocabulary comes from). It was
essentially an electric typewriter bolted to a communications line:

```
   YOU              THE TERMINAL (hardware)                THE COMPUTER
  ┌────┐   type    ┌──────────────────────┐   serial     ┌───────────────┐
  │ 🧑 │ ────────► │  Teletype Model 33   │ ═══════════► │   mainframe    │
  └────┘           │  (keyboard + printer)│  (RS-232)    │   running a    │
        read paper │                      │ ◄═══════════ │   program      │
        ◄───────── │  prints on paper     │   bytes      └───────────────┘
                   └──────────────────────┘
```

You typed a character; the terminal sent that byte down the wire. The computer's
program read the byte, did something, and sent bytes *back*, which the terminal
**printed onto a roll of paper** (later, onto a screen). The computer had no idea
what was on the far end of the cable — it just did `read()` and `write()` on a
serial port. The terminal was **dumb**: it knew nothing about the program, only
"send the keys, print the bytes."

**The 1970s — "glass teletypes."** Paper gave way to CRT screens. The most
important of these, the **DEC VT100 (1978)**, could do things paper couldn't: move
the cursor, clear the screen, show bold or reverse-video text. To trigger these
tricks, the computer sent special byte sequences beginning with the **ESC**
character. Those sequences — the **ANSI/VT100 escape codes** — were so widely
copied that **we still emit the exact same bytes today** (section 2.6). A VT100
died decades ago; its language is immortal.

**The 1980s onward — the terminal disappears, but its software doesn't.** Personal
computers and workstations had their *own* screen and keyboard built in. The
separate terminal on the end of a cable was gone. But there was a catch:
**thousands of programs — including every shell — were written to talk to a
terminal over a serial line.** Rewriting them all was unthinkable. So instead we
faked it. We wrote a *program* that behaves exactly like a VT100: it draws a grid
of characters in a window, sends your keystrokes as bytes, and interprets the
escape codes to move a cursor and paint colors. That program is a **terminal
emulator**.

> **The punchline:** a "terminal" on your machine today is a **terminal emulator**
> — software impersonating a 1978 piece of hardware, kept alive so that programs
> written for real terminals still run unchanged. GNOME Terminal, iTerm2,
> Alacritty, the macOS Terminal, and — crucially for us — **xterm.js** are all
> VT100 impersonators.

> **🔧 In cmux-linux:** the terminals you see in the app are drawn by **xterm.js**,
> a terminal emulator written in TypeScript that runs *inside a web page*. It is a
> direct descendant of that 1978 VT100 — it accepts the same escape codes and
> paints the same grid. Chapter `07-xtermjs.md` is entirely about it.

But this raises the question that the rest of the chapter answers. If the terminal
is now just a program, and the shell is also just a program, and there's no serial
cable between them anymore… **what connects them?** Hold that thought until 2.5.

---

## 2.2 The three layers (the mental model to hang everything on)

Every terminal interaction you will ever have — on any Unix system, in our app or
anyone else's — is three layers stacked together. Memorize this diagram; the whole
chapter is just zooming into each layer.

```
        ┌──────────────────────────────────────────────────────────┐
  (a)   │  TERMINAL EMULATOR   — the screen + keyboard              │
        │  • draws a grid of characters, in a font, with colors     │
        │  • turns your key presses into bytes                      │
        │  • interprets escape codes to move the cursor / paint     │
        │    e.g. GNOME Terminal, iTerm2, xterm.js                  │
        └───────────────┬──────────────────────────────────────────┘
                        │  bytes in both directions
        ┌───────────────┴──────────────────────────────────────────┐
  (b)   │  THE TTY / PTY DEVICE  — the "wire" (lives in the kernel) │
        │  • a two-ended pipe the OS provides                       │
        │  • buffers input, runs the "line discipline" (2.8)        │
        │  • remembers the window size (2.9)                        │
        │  • turns Ctrl-C into a SIGINT signal                      │
        └───────────────┬──────────────────────────────────────────┘
                        │  stdin / stdout / stderr
        ┌───────────────┴──────────────────────────────────────────┐
  (c)   │  THE SHELL (or any program)  — bash, zsh, vim, python     │
        │  • reads bytes from stdin, writes bytes to stdout         │
        │  • has NO screen of its own; it only reads/writes bytes   │
        │    and trusts layer (b) to be a terminal                  │
        └──────────────────────────────────────────────────────────┘
```

Say it in one breath: **a terminal emulator (a) and a shell (c) never touch each
other; they only ever read and write bytes to a kernel device in the middle (b)
that pretends to be an old serial terminal.**

The genius — and the source of every confusion — is that layer (c) *cannot tell*
that layer (a) is software. As far as bash is concerned, it is talking to a real
VT100 over a real cable, exactly like 1978. That illusion is maintained by
layer (b), and building layer (b) in software is what a **PTY** is (2.5).

A web analogy to anchor it:

| Terminal world | Web-dev world you know |
|---|---|
| Terminal emulator (a) | The **browser tab** — the rendering surface + input |
| The TTY/PTY device (b) | The **network socket / connection** between them |
| The shell (c) | The **server-side app** that reads requests and writes responses |

Just like a Node server never touches the browser directly — it reads and writes a
socket, and something else paints the pixels — bash never touches xterm.js. Both
sides talk to a byte channel in the middle and trust the other end to behave.

---

## 2.3 Everything is a byte stream: stdin, stdout, stderr

Before we build the wire, let's nail down *what flows through it*: **bytes**, via
three channels that every Unix program is born with.

When the OS starts any process, it hands it three already-open **file
descriptors** — small integers that are handles to something the kernel can read
from or write to:

```
  fd 0  →  STDIN   "standard input"    — where the program READS input
  fd 1  →  STDOUT  "standard output"   — where the program WRITES normal output
  fd 2  →  STDERR  "standard error"    — where the program WRITES error messages
```

A file descriptor is deliberately dumb: it doesn't know or care whether it points
at a file, a network socket, a pipe, or a terminal. The program just calls
`read(0, …)` and `write(1, …)`. **When you launch a program in a terminal, all
three fds are connected to the terminal device** (layer b). So:

- `read(0)` returns the bytes you type.
- `write(1)` puts bytes on the screen.
- `write(2)` *also* puts bytes on the screen — but through a separate channel, so
  they can be redirected independently.

> **You already know these three.** In Node they're `process.stdin`,
> `process.stdout`, and `process.stderr`. `console.log` writes to fd 1;
> `console.error` writes to fd 2. That's not an analogy — they are *literally* the
> same file descriptors 0/1/2 this section is describing. Systems programming
> often feels like discovering that Node was a thin coat of paint over the OS all
> along.

**Why two output streams (stdout vs stderr)?** So you can separate the *data* a
program produces from its *diagnostics*. Consider:

```sh
grep "ERROR" app.log > errors.txt 2> grep-problems.txt
```

- `> errors.txt` redirects **fd 1** (the matching lines — the useful output) into a
  file.
- `2> grep-problems.txt` redirects **fd 2** (warnings like "permission denied on
  some-file") into a *different* file.

The matched lines and the complaints go to different places, even though both would
otherwise have landed on your screen. That's the entire reason stderr exists as a
separate stream.

**Redirection and pipes are just "repoint the fd."** This is the big idea:

```sh
ls > files.txt        # fd 1 now points at a file, not the terminal
sort < names.txt      # fd 0 now reads from a file, not the keyboard
ls | grep foo         # ls's fd 1 is wired to grep's fd 0 through a kernel pipe
```

`ls` has *no idea* any of this happened. It always just `write()`s to fd 1. The
shell rewires fd 1 to a file, a pipe, or the terminal *before* launching `ls`. The
program is blissfully ignorant of where its bytes go — which is exactly why the
same `ls` works whether you're looking at its output, saving it, or feeding it to
another command.

> **⚠️ Gotcha — "is anyone actually watching?"** Because a program can't easily
> tell what fd 1 points at, it may *ask* the kernel: "is my stdout a real
> terminal?" via the `isatty()` call. Many programs light up with **color only
> when the answer is yes.** That's why `ls` is colorful on screen but `ls | cat`
> or `ls > file.txt` is plain — piping/redirecting means "not a terminal," so `ls`
> disables color. Remember this; it's the reason our whole app needs a *real*
> terminal device and not a plain pipe (2.5, 2.10).

---

## 2.4 The shell is just a program (and it is NOT the terminal)

This is the distinction that trips up every beginner, so we'll be blunt: **the
shell and the terminal are two completely separate things.**

- The **terminal** (emulator) is the *screen and keyboard* — layer (a). Its job is
  drawing characters and capturing keystrokes. It knows nothing about commands,
  files, or `PATH`.
- The **shell** (bash, zsh, fish) is a *program that runs inside* the terminal —
  layer (c). It's an ordinary user program, not part of the OS. Its job is to be a
  **REPL for the operating system**:

  ```
  loop forever:
    1. print a prompt        (the "$" or "%")
    2. read a line of input  (from stdin — fd 0)
    3. parse it into a command + arguments
    4. find the program (search $PATH), then fork + exec it
    5. wait for it to finish; print its exit status if you ask
    6. go to step 1
  ```

That's *all* a shell is. Prompts, `$PATH` lookup, environment variables, tab
completion, pipes, `if`/`for` scripting, job control (`Ctrl-Z`, `bg`, `fg`) — every
one of those is a **shell** feature, invented by bash/zsh. The terminal contributes
none of it.

The clean way to feel the separation: **you don't have to run a shell in a
terminal at all.** Type `vim`, `top`, `python3`, or `node` and the shell steps
aside — now the terminal is displaying *that* program instead. The terminal
happily draws whatever byte stream it's given; it has no opinion about whether
those bytes come from bash or from vim.

> **Web analogy:** the terminal emulator is the **browser tab** (the chrome, the
> rendering engine, the input handling); the shell is **one web app you happen to
> have open in it**. Navigating from bash to vim is like navigating from one URL to
> another in the same tab. Closing the tab (the terminal) tears down whatever app
> was loaded, but the tab and the app were never the same thing.

> **⚠️ Gotcha — closing the window vs killing the shell.** When you close a
> terminal window, the shell usually dies *too* — but not because they're the same
> object. It's because the shell was the *child program the terminal launched*, and
> tearing down the terminal (specifically, the master end of the PTY — 2.5) sends
> the shell a hang-up signal (`SIGHUP`), the modern echo of a phone line going
> dead. Two separate things, one causal link. In cmux-linux this matters: our
> shells live in a *different process* from the window, so we control that
> lifecycle deliberately (chapter `06-node-pty.md`).

> **🔧 In cmux-linux:** the shell is spawned by **node-pty** in the **main**
> process — the Node backend — not in the window. The window (renderer) only draws
> the picture. That's the "the terminal you see is a puppet" idea from Chapter 1,
> now with names: xterm.js = the puppet (a), node-pty's shell = the puppeteer's
> hand (c), and the PTY = the strings between them (b).

---

## 2.5 The PTY: a fake serial cable the kernel builds for us

Now we answer the question from 2.1. In 1978, layer (b) was a real serial cable
plus the terminal's guts. Today there's no cable — the emulator and the shell are
both just programs on the same machine. So the kernel **fakes the cable in
software.** That fake is a **pseudo-terminal**, or **PTY**.

A PTY is a *pair* of connected virtual devices the kernel creates on demand. The
two ends have names (the terminology is unfortunately historical; both name-pairs
mean the same two ends):

- The **master** end (modern term: **PTY primary**). Held by the **terminal
  emulator**. This is "where the terminal hardware used to plug in."
- The **slave** end (modern term: **PTY subordinate**). Handed to the **shell** as
  its stdin/stdout/stderr. This is "the serial port the computer reads and writes."

The magic property: **the slave end is indistinguishable from a real terminal.** It
has a line discipline (2.8), it honors terminal settings (echo on/off, canonical
mode), it stores a window size (2.9), and `isatty()` on it returns *true*. So when
bash opens the slave, `isatty(1)` says "yes, you're on a real terminal!" and bash
turns on colors, its prompt, job control — the full experience. **bash cannot tell
it isn't 1978.** That illusion is the entire point of a PTY.

Here is the pipe, drawn end to end. Trace one keystroke (`l`) rightward and one
line of output leftward:

```
   TERMINAL EMULATOR              KERNEL: one PTY (a matched pair)                SHELL
   (xterm.js / GNOME)                                                            (bash)
  ┌──────────────────┐   ┌────────────────────────────────────────────┐   ┌────────────────┐
  │ you press  'l'   │   │   MASTER end            SLAVE end           │   │                │
  │       │          │   │  ┌──────────┐   ┌───────────────┐          │   │                │
  │  write(master) ──┼──►│  │  master  │──►│ line          │──►stdin  ├──►│ read(0) → 'l'  │
  │                  │   │  │  buffer  │   │ discipline    │  (fd 0)  │   │                │
  │                  │   │  └──────────┘   │ (echo, Ctrl-C,│          │   │                │
  │                  │   │                 │  line editing)│          │   │                │
  │ paint "file1     │   │  ┌──────────┐   └───────────────┘  stdout  │   │ write(1)       │
  │       file2"  ◄──┼───┤  │  master  │◄──────────────────────(fd 1) ├◄──┤ "file1 file2"  │
  │  read(master)    │   │  │  buffer  │◄──────────────────────(fd 2) │   │ write(2) errs  │
  │                  │   │  └──────────┘         stderr               │   │                │
  └──────────────────┘   └────────────────────────────────────────────┘   └────────────────┘
        LAYER (a)                          LAYER (b)                            LAYER (c)
```

Read it as two one-way trips sharing a device:

1. **Keystroke (rightward).** You press `l`. The emulator writes the byte `l` to
   the **master**. The kernel passes it through to the slave, *via the line
   discipline* (which may echo it back and may buffer it — 2.8). Eventually bash's
   `read(0)` returns `l`.
2. **Output (leftward).** bash decides to print. It `write()`s bytes to fd 1 (the
   slave). They travel back out the **master**, where the emulator `read()`s them
   and paints them onto the grid — interpreting any escape codes along the way
   (2.6).

Two independent directions, one bidirectional device. That's a PTY.

**Why does this contraption exist at all?** Three reasons, all of which we cash in
later:

1. **Backward compatibility for free.** Every terminal-oriented program already
   knows how to talk to a TTY. Give it a PTY slave and it just works, unmodified —
   no rewrite of bash, vim, or `git` required.
2. **The kernel's line discipline comes along for free.** All that legacy behavior
   — line editing with backspace, turning `Ctrl-C` into a signal, echoing your
   typing — is implemented once, in the kernel, and reused by every PTY. We don't
   reimplement it; we inherit it (2.8).
3. **It's the universal adapter for "run a terminal program under my control."**
   PTYs are how `ssh` gives you a shell on a remote box, how `tmux`/`screen` sit
   between you and your shells, how `script` records a session — and how **our app
   runs a shell inside a window.** Same mechanism every time.

> **⚠️ Gotcha — a pipe is NOT a PTY.** In Node, `child_process.spawn('bash')` wires
> the child up with plain **pipes**, not a PTY. bash's `isatty()` then returns
> *false*, so you get no colors, no prompt, no job control, no line editing — a sad,
> half-dead shell. This is *the* reason the `node-pty` library exists as a separate
> native addon: creating a real PTY pair requires OS calls that plain
> `child_process` doesn't make. **node-pty gives you a real terminal; a pipe gives
> you a corpse.** Chapter `06-node-pty.md` is built on this distinction.

> **🔧 In cmux-linux:** node-pty creates the PTY pair, `exec`s bash on the *slave*
> side, and hands **us the master end** as a Node stream object. When we call
> `ptyProcess.write("ls\n")`, that's "write to the master" (the keystroke trip).
> When `ptyProcess.onData((bytes) => …)` fires, that's "read from the master" (the
> output trip). Those two calls are the entire top row of the diagram above —
> everything else in the app is plumbing around them.

---

## 2.6 Escape sequences, part 1: how bytes become colors and cursors

We've been saying "bytes flow through the wire." But if it's *just* bytes, how does
`git` make text red, or `vim` move the cursor to the top-left, or a progress bar
overwrite itself in place? There's no separate "formatting channel." The answer is
delightfully sneaky: **the control commands are mixed right into the same byte
stream as the text**, and the terminal emulator watches for special byte patterns
that mean "this isn't text to print — it's an instruction."

### Control characters — the first 32 bytes

The bytes `0x00`–`0x1F` aren't printable letters; they're **control characters**,
each with a meaning inherited from teletype days:

| Byte | Name | Escape in `printf` | Effect |
|---|---|---|---|
| `0x0A` | Line Feed (LF) | `\n` | Move the cursor **down** one row |
| `0x0D` | Carriage Return (CR) | `\r` | Move the cursor to **column 0** (start of line) |
| `0x09` | Tab | `\t` | Advance to the next tab stop |
| `0x08` | Backspace | `\b` | Move the cursor **left** one column |
| `0x07` | Bell | `\a` | **Beep** (or flash) — a leftover from a literal bell on the Teletype |
| `0x1B` | **Escape (ESC)** | `\033` (octal) / `\e` / `\x1b` | "The next bytes are a **command**, not text" |

Two of these explain a famous Windows-vs-Unix quirk. On a real teletype, ending a
line meant two *physical* motions: **return the carriage** to the left (CR) and
**feed the paper up** one line (LF). That's why Windows line endings are `\r\n` —
they encode both motions literally. Unix collapsed it to just `\n`. Keep CR (`\r`)
and LF (`\n`) as *separate* motions in your head; it pays off in a minute.

**Worked example — the humble progress bar.** How does `Downloading… Done!`
overwrite itself on one line, without scrolling? With `\r`:

```sh
printf 'Downloading...'; sleep 1; printf '\rDone!         \n'
```

Walkthrough: we print `Downloading...` (cursor is now sitting after the dots).
`\r` yanks the cursor back to **column 0 of the same line** (no new line). Then
`Done!` prints *over* the old text starting at the left. The trailing spaces are
deliberate — they paint over the leftover `ng...` characters from the longer word.
Finally `\n` drops to the next line. Every spinner and progress bar you've ever
seen is this trick: `\r` to the start, reprint. No magic.

> **⚠️ Gotcha — the "staircase."** `\n` moves **down but not left** (it's *only*
> LF, not CR+LF). In a normal terminal the line discipline quietly translates your
> `\n` into `\r\n` so text starts at the left each line. But in **raw mode** (2.8),
> that translation is off, and a lone `\n` gives you:
> ```
> line one
>          line two
>                   line three
> ```
> Everyone who writes raw-mode terminal output hits this once. The fix: emit
> `\r\n` yourself.

### Escape sequences and the CSI

Thirty-two control characters can't express "move cursor to row 3, column 10" or
"make the foreground bright magenta." There simply aren't enough of them. So
terminals use **escape sequences**: multi-byte commands that begin with the ESC
character (`0x1B`). The overwhelmingly most common family is the **CSI — Control
Sequence Introducer** — which is `ESC` followed by `[`:

```
   ESC   [    3 1     m
  \033   [  «params» «final»
   │     │     │        └── the command letter: m = set color/style,
   │     │     │            H = move cursor, J = erase, A/B/C/D = arrows
   │     │     └─────────── numeric parameters, separated by ';'
   │     └───────────────── '[' = CSI: "a screen-control command follows"
   └─────────────────────── ESC (0x1B): "the next bytes are a command, not text"
```

So the byte string `\033[31m` means: *ESC, begin control sequence, parameter 31,
command `m`.* Command `m` is **SGR (Select Graphic Rendition)** — "change text
appearance" — and parameter `31` means "foreground red." The terminal reads those
five bytes, prints **nothing**, and instead flips its "current color" to red. Every
character *after* that comes out red until you change it again.

**The worked example the whole chapter has been building toward:**

```sh
printf '\033[31mred\033[0m\n'
```

Byte-by-byte, here's what the terminal emulator does:

1. `\033[31m` → SGR 31: set foreground to red. Nothing is printed; internal state
   changes.
2. `r`, `e`, `d` → three ordinary characters, painted in the *current* color: red.
3. `\033[0m` → SGR 0: **reset** all attributes back to default. (This is the step
   people forget — omit it and your prompt, and everything after, stays red.)
4. `\n` → newline.

Result: the word **red**, in red, then back to normal. That is the *entire*
mechanism behind colored output in `git`, `ls`, test runners, and every CLI you've
ever admired. It's just bytes carrying `\033[…m` markers inline with the text.

**A cheat-sheet of the CSI sequences you'll actually meet:**

| Sequence | Name | Effect |
|---|---|---|
| `\033[0m` | SGR 0 | Reset all colors/styles to default |
| `\033[1m` | SGR 1 | **Bold** / bright |
| `\033[4m` | SGR 4 | Underline |
| `\033[7m` | SGR 7 | Reverse video (swap fg/bg) |
| `\033[31m` … `\033[37m` | SGR | Foreground color (red…white) |
| `\033[41m` … `\033[47m` | SGR | Background color |
| `\033[38;5;208m` | SGR | Foreground from the **256-color** palette (208 = orange) |
| `\033[38;2;255;105;180m` | SGR | Foreground **truecolor** RGB (here, hot pink) |
| `\033[H` | CUP | Move cursor to **home** (row 1, col 1) |
| `\033[3;10H` | CUP | Move cursor to **row 3, column 10** |
| `\033[2A` `\033[2B` `\033[2C` `\033[2D` | CUU/CUD/CUF/CUB | Move cursor **up/down/right/left** by 2 |
| `\033[2J` | ED | **Erase** the entire screen |
| `\033[K` | EL | Erase from cursor to end of line |

**Worked example — clear the screen and draw at a spot:**

```sh
printf '\033[2J\033[3;10HHello!\n'
```

`\033[2J` erases the whole screen; `\033[3;10H` parks the cursor at row 3, column
10; then `Hello!` prints there. This — clearing, then positioning, then drawing —
is the beating heart of every "full-screen" terminal app. `vim`, `htop`, and `tmux`
are, at bottom, just very elaborate loops of *erase, move cursor, print, repeat*.

> **🔧 In cmux-linux:** the emulator that reads and obeys all of these bytes is
> **xterm.js**. When bash (in the main process) writes `\033[31m`, those exact
> bytes travel out the PTY master → through node-pty → over Electron IPC → into
> xterm.js in the renderer, which parses the CSI and flips the on-screen color to
> red. **We never write a color-parser ourselves** — xterm.js is a full VT100/xterm
> interpreter, and inheriting that is *why we chose it* (chapter `07-xtermjs.md`).

> **A useful mental model:** think of escape codes as the terminal's version of an
> imperative drawing API — like calling `ctx.fillStyle = 'red'` and
> `ctx.moveTo(x, y)` on an HTML `<canvas>`, except the "function calls" are encoded
> as byte sequences *interleaved with the text* rather than as JavaScript. The
> terminal is a canvas; escape codes are its drawing commands.

---

## 2.7 Escape sequences, part 2: OSC — talking to the terminal itself

CSI sequences manipulate the *character grid* — colors, cursor, erasing. But
sometimes a program wants to talk to the **terminal application as a whole**: "set
your window title," "put this on the clipboard," "pop a desktop notification."
Those aren't grid operations, so they use a different family: **OSC — Operating
System Command.**

An OSC sequence is `ESC ]` (note: a **`]`** bracket, versus CSI's `[`), then a
number identifying the command, a `;`, a **string** payload, and a terminator. The
terminator is either the Bell character `\a` (`0x07`) or the two-byte **String
Terminator** `ESC \` (written `\033\\` in `printf`):

```
   ESC  ]   2  ;   my project — main       BEL
  \033  ]  «cmd» ; «string payload»      «terminator (\a or \033\)»
   │    │    │        │                       └── ends the string
   │    │    │        └────────────────────────── arbitrary text argument
   │    │    └─────────────────────────────────── which OS command (0/2 = title …)
   │    └──────────────────────────────────────── ']' = OSC (vs '[' for CSI)
   └───────────────────────────────────────────── ESC: a command follows
```

**Worked example — set the window/tab title:**

```sh
printf '\033]0;my project — main\a'
```

`\033]0;` begins OSC command **0**; the payload is `my project — main`; `\a` ends
it. The terminal prints nothing on the grid — instead it **retitles its window and
tab**. Command **2** (`\033]2;…`) does the same for the window title only; command
**0** sets both the window title and the older "icon name." This is exactly how
your shell shows the current directory in the tab: zsh/bash emit an OSC 0/2 from
inside the prompt every time it redraws.

Other OSC commands you'll bump into: **OSC 8** (clickable hyperlinks in output),
**OSC 52** (write to the system clipboard), **OSC 10/11** (query/set the default
fg/bg colors), **OSC 7** (report the current working directory to the terminal).

> **⚠️ Gotcha — `[` vs `]`.** CSI is `\033[` (square bracket **open**); OSC is
> `\033]` (square bracket **close**). One character apart, wildly different
> behavior — `\033[2;…` moves the cursor; `\033]2;…` sets the title. When an escape
> sequence "does nothing" or garbles, check this bracket first.

### Preview: OSC 9 / 99 / 777 — notifications (our signature feature)

Here's the one that matters most for cmux-linux. Several OSC commands exist to fire
a **desktop notification** straight from the byte stream — no library, no API, just
`printf`:

```sh
# iTerm2-style notification (OSC 9): payload is just the message
printf '\033]9;Build finished\a'

# urxvt/notify-style (OSC 777): payload is  notify ; <title> ; <body>
printf '\033]777;notify;Build;All tests passed\033\\'
```

Think about how powerful that is. **Any** program that can write to stdout — a
shell script, a test runner, a coding agent like Claude Code — can pop a desktop
notification by printing a magic string. It needs to know *nothing* about your
desktop environment. It just emits bytes, and the terminal (which *does* know how
to show a notification) does the rest. This is the terminal-native way to say "hey,
I need you."

That is precisely the hook cmux-linux hangs its identity on. When an agent finishes
and wants your attention, one path is that it prints an OSC 9/99/777. The **main
process is watching the PTY byte stream for exactly these sequences**, and when it
spots one it lights up the sidebar, rings the pane, and fires an OS notification —
the "which agent needs me?" magic from Chapter 1.

> **🔧 In cmux-linux:** we treat the terminal output as *two* audiences at once. The
> bytes go to **xterm.js** to be drawn, *and* the same bytes are scanned in the
> main process for OSC 9/99/777. One is a display; the other is an event source.
> The full parsing pipeline — which codes, how we extract title/body, how it drives
> the rings — is chapter `12-notifications-and-osc.md`. For now just hold this: **a
> notification is a specific escape code in the stream**, and we already know
> escape codes are just bytes.

---

## 2.8 The line discipline: canonical vs raw, echo, and hidden passwords

Return to layer (b), the PTY, and zoom into the box labeled "line discipline." This
is a small but mighty piece of kernel code sitting between the raw byte stream and
the program, and it explains three things that otherwise seem like magic: why your
typing appears on screen, why backspace works even in a dumb script, and why
passwords don't show up.

The line discipline runs in one of two broad modes, configured by **termios**
settings (which any program can flip):

### Canonical mode (a.k.a. "cooked" mode) — the default

In canonical mode the kernel buffers input **one line at a time** and does a
surprising amount of work *before your program ever sees a single byte*:

- **It echoes.** Each character you type is copied back to the terminal so you can
  *see* what you're typing. (More on this being a deliberate act below.)
- **It edits the line for you.** Backspace erases the previous character. `Ctrl-U`
  kills the whole line. `Ctrl-W` deletes the last word. All of this happens *inside
  the kernel*, invisibly — the program never sees the deleted characters.
- **It waits for Enter.** Only when you press Return does the kernel hand the whole,
  finished line to the program's `read()` in one delivery.
- **It turns keys into signals.** `Ctrl-C` becomes a **SIGINT** sent to the
  foreground program (usually: die). `Ctrl-Z` becomes **SIGTSTP** (suspend).
  `Ctrl-D` at the start of a line signals **end-of-input (EOF)**. `Ctrl-\` becomes
  **SIGQUIT**.

Here's the mind-bender for a web dev: when a bash script runs `read name`, **bash
didn't implement backspace or line editing.** The *kernel's line discipline* did.
You can type, mistype, backspace, retype, and only the final clean line reaches
bash on Enter. bash got a free `<input>` element from the operating system.

### Raw mode — for programs that want every keystroke

Some programs need to react to *each* keypress instantly and control the screen
themselves. `vim` must respond to a bare `j` (move down) with no Enter. A REPL must
handle the Up-arrow for history. So these programs switch the terminal into **raw
mode**, which turns *off* canonical buffering (and usually echo, and signal
generation). Now:

- Every keystroke is delivered to the program **immediately**, one byte at a time.
- The program is responsible for **everything** — drawing what you type, handling
  backspace, interpreting arrow keys, deciding what `Ctrl-C` means.

That's why `Ctrl-C` inside vim doesn't kill vim: vim asked for raw mode, so the
kernel no longer converts `Ctrl-C` into a signal — it just hands vim the byte
`0x03`, and vim decides to ignore it. The same key is a "kill" at a bash prompt
(canonical) and a no-op in vim (raw), because the *mode of the line discipline* is
different.

```
  CANONICAL (cooked): you ──type──► [kernel buffers a whole line,
                                     echoes it, handles backspace,
                                     turns ^C into SIGINT] ──whole line──► program
                                     e.g. a bash prompt, `read` in a script

  RAW:                you ──type──► [kernel passes each byte straight through,
                                     no echo, no editing, ^C is just 0x03] ──byte──► program
                                     e.g. vim, less, top, a fancy REPL
```

### Echo — why your keystrokes appear at all

This deserves its own spotlight because it violates a web-dev intuition hard. In a
browser `<input>`, the **browser** draws each character as you type — input and
display are the same widget. **In a terminal, they are not.** When you press a key,
the byte travels *away* from the screen, into the PTY, toward the program. It
appears on screen **only because something deliberately echoes it back**:

- In **canonical mode**, the **kernel's line discipline** echoes it (the ECHO
  termios flag).
- In **raw mode**, the *program* echoes it — e.g., bash's own line editor prints
  the character back as part of drawing your command line.

Either way, echo is an *action taken by software*, not an automatic property of
typing. Turn echo off and your keystrokes still reach the program perfectly — they
just leave no mark on the screen.

### Why passwords don't echo (the whole trick, finally)

When `sudo` or `ssh` prompts `Password:`, watch what happens: you type, and
*nothing appears*. Here is the entire mechanism: the program **turns off the ECHO
flag** (via termios) before reading, and turns it back on afterward. The kernel
still faithfully receives every keystroke and delivers your password to the
program — it simply stops copying the characters to the screen while ECHO is off.
No masking, no dots, no special "password widget." Just: *echo, temporarily
disabled.* Anticlimactic and beautiful.

You can feel all of this yourself with the `stty` command, which reads and writes
line-discipline settings:

```sh
stty -echo                 # turn echo OFF
read secret                # type something and press Enter — you see nothing
stty echo                  # turn echo back ON
echo "you actually typed: $secret"   # ...but it was captured all along
```

> **🔧 In cmux-linux:** because our shell runs on a *real* PTY (thanks to node-pty,
> not a pipe), we get this entire line-discipline machine for free — canonical
> editing at the prompt, raw mode when vim asks for it, `Ctrl-C` becoming a signal,
> and password prompts that correctly hide input. If we'd used a plain pipe, none
> of it would work, and typing a `sudo` password in our app would splash it across
> the screen. This is another concrete reason the PTY (2.5) is non-negotiable.

> **⚠️ Gotcha — who's echoing?** A classic bug in home-grown terminals is
> characters appearing **twice** (both the program *and* the line discipline echo)
> or **not at all** (neither does). With node-pty + xterm.js you sidestep this: the
> PTY's line discipline handles echo, and xterm.js just displays whatever comes
> back out the master. Don't add your own "show the key I pressed" logic in the
> renderer — that's the line discipline's job, and doubling it is the bug.

---

## 2.9 How big am I? Terminal size and the SIGWINCH signal

One more property lives on the PTY device: its **size**, measured in **columns ×
rows** of character cells (the classic VT100 default is **80 × 24**). This is not a
pixel size — it's a *grid* size, and the kernel stores it right on the TTY/PTY as a
little `struct winsize`.

Why does anyone care? Line-by-line programs (like a shell scrolling output) mostly
don't. But **full-screen "TUI" apps must know the exact grid to draw correctly.**
`vim` needs to know it has, say, 80 columns and 24 rows so it can place its status
line on row 24, wrap text at column 80, and center a message. `htop`, `less`,
`tmux`, and every dashboard-style tool are the same: they *paint to a grid*, and
they must know that grid's dimensions or the output is scrambled.

A program asks "how big am I?" by querying the device (the `ioctl(fd, TIOCGWINSZ)`
call). The shell surfaces the answer as the `$COLUMNS` and `$LINES` variables, and
you can read it directly:

```sh
stty size      # prints:  24 80   (rows cols)
tput cols      # prints:  80
tput lines     # prints:  24
```

> **⚠️ Gotcha — no terminal, no size.** Run those commands where stdout *isn't* a
> real terminal (say, piped through another process) and `stty size` reports an
> error and `tput` falls back to a guessed 80 × 24. It's the same `isatty()` truth
> from 2.3: size is a property of a *terminal device*, so if there's no terminal,
> there's no honest answer. (You may see this exact behavior if you run our shell
> without a proper PTY — one more reason node-pty matters.)

### Resizing: the SIGWINCH dance

Now the interesting part. When you drag the terminal window bigger, the grid
changes — maybe from 80 × 24 to 120 × 40. How does `vim`, already running, find
out and redraw to fill the new space? A little four-step cooperative dance:

```
  1. You drag the window edge.
        │
  2. The terminal emulator computes the new grid:
        new_cols = window_width_px  ÷ font_cell_width_px
        new_rows = window_height_px ÷ font_cell_height_px
     …and writes the new size onto the PTY (ioctl on the master).
        │
  3. The kernel notices the size changed and sends the signal
        SIGWINCH  ("window change")
     to the foreground program on that terminal (e.g. vim).
        │
  4. vim's SIGWINCH handler re-queries the size (TIOCGWINSZ),
     then erases and repaints itself to fit the new grid.
```

So a resize is not one action but a **conversation**: the emulator sets the size →
the kernel *signals* the program → the program re-reads the size and repaints
itself. If a program doesn't bother to handle SIGWINCH (many simple ones don't), it
just keeps using the old dimensions until the next time it happens to ask — which
is why a naive program can look wrong after a resize until you nudge it.

> **Web analogy:** SIGWINCH is the terminal's `window.addEventListener('resize',
> …)`. Same idea — "the viewport changed, re-layout" — but delivered as a Unix
> signal to a process instead of a DOM event to a callback. Programs that ignore it
> are like a webpage with a fixed-pixel layout that doesn't reflow: technically
> still running, visibly broken.

> **🔧 In cmux-linux:** when you drag a pane divider or resize the window, xterm.js
> (with its **fit addon**) recomputes how many cols × rows now fit, and we call
> **`ptyProcess.resize(cols, rows)`** in node-pty. That performs step 2 (write the
> new size to the PTY master), the kernel does step 3 (SIGWINCH to the shell/vim),
> and the program does step 4 (repaint). Get this wiring wrong and vim inside a
> pane draws to the *old* size — a garbled display — until it's nudged. Chapters
> `06-node-pty.md` and `07-xtermjs.md` implement the two halves of this handshake.

---

## 2.10 The whole thing, as cmux-linux

Time to collapse all five ideas — the three layers, byte streams, the shell, the
PTY, escape codes, line discipline, and size — into the exact shape of our app.
Nothing new here; it's the same physics with our library names attached. This is
the diagram to keep taped above your desk:

```
        RENDERER PROCESS                                 MAIN PROCESS (Node)
        (Chromium + React)              IPC              (the backend)
  ┌────────────────────────────┐     bridge        ┌──────────────────────────────┐
  │  xterm.js                  │   (chapters       │  node-pty                     │
  │  = TERMINAL EMULATOR (a)   │    04 & 05)       │  = holds the PTY MASTER (b)   │
  │                            │                   │                               │
  │  • you press a key ────────┼──ipc: send──────► │  ptyProcess.write(bytes)      │
  │                            │                   │        │                      │
  │                            │                   │        ▼  (master → slave,    │
  │                            │                   │        through line          │
  │                            │                   │        discipline: echo,     │
  │                            │                   │        cooked/raw, ^C→SIGINT)│
  │                            │                   │   ┌─────────────────────┐    │
  │                            │                   │   │  THE PTY (kernel)    │    │
  │                            │                   │   └─────────┬───────────┘    │
  │                            │                   │             ▼ slave = stdio  │
  │                            │                   │      ┌──────────────┐        │
  │                            │                   │      │  bash (c)    │        │
  │                            │                   │      │  reads stdin │        │
  │                            │                   │      │  writes bytes│        │
  │                            │                   │      │  incl. \033[…│        │
  │                            │                   │      └──────┬───────┘        │
  │  • xterm.js paints ◄───────┼──ipc: onData──────┤  pty.onData(bytes) ◄─────────┤
  │    the grid, obeys \033[…  │                   │        │                     │
  │    (colors, cursor, clear) │                   │        └─► ALSO scanned here │
  │                            │                   │            for OSC 9/99/777  │
  │                            │                   │            → fire notification│
  │  • drag to resize ─────────┼──ipc─────────────►│  pty.resize(cols,rows)       │
  │    (fit addon → cols,rows) │                   │    → kernel SIGWINCH → repaint│
  └────────────────────────────┘                   └──────────────────────────────┘
```

Walk the loops one final time, now fully named:

- **You type.** xterm.js (the emulator, layer a) captures the key, sends it over
  IPC; node-pty writes it to the **PTY master** (layer b); the line discipline
  cooks/echoes it; bash's `read()` gets it (layer c). *That's 2.5's rightward
  trip.*
- **The shell prints.** bash `write()`s bytes to its stdout (the slave), possibly
  containing `\033[31m…`; they exit the **master**; `pty.onData` fires; we IPC them
  to xterm.js, which parses the escape codes and paints red text at the cursor.
  *That's 2.5's leftward trip + 2.6's escape parsing.*
- **An agent needs you.** The same output bytes are *also* scanned in the main
  process for an OSC 9/99/777 (2.7). Spotting one triggers the sidebar ring and a
  desktop notification. *That's the Chapter 1 "magic," and it's just an escape code
  in the byte stream.*
- **You resize a pane.** xterm.js's fit addon computes new cols × rows; we call
  `pty.resize`; the kernel sends **SIGWINCH**; vim repaints. *That's 2.9's dance.*

Notice what our own code is and isn't. We do **not** write a VT100 interpreter
(xterm.js is that), and we do **not** implement line editing, echo, or signal
handling (the kernel's line discipline is that). Our job is the **plumbing between
the layers** — moving bytes across the process boundary via IPC, and watching the
stream for the codes that make the sidebar come alive. The terminal *physics* in
this chapter is the bedrock; every remaining chapter is an engineering detail
bolted onto it.

---

## 2.11 The mental model to carry everywhere

If you remember nothing else from this chapter, carry these six sentences:

1. **A "terminal" today is a program impersonating 1978 hardware** — an emulator.
2. **Three layers, always:** emulator (a) ↔ TTY/PTY device (b) ↔ shell/program (c).
   The outer two never touch; they only read/write bytes to the middle.
3. **It's all byte streams** — `stdin`/`stdout`/`stderr` (fds 0/1/2), the same
   `process.stdin/out/err` you know from Node.
4. **The shell is just a program running inside the terminal** — bash ≠ the
   terminal, the way a web app ≠ the browser tab.
5. **A PTY is a kernel-built fake serial cable** with a **master** (held by the
   emulator) and a **slave** (the shell's stdio); it exists so unmodified terminal
   programs run under a software emulator and inherit the line discipline for free.
6. **Colors, cursors, titles, and notifications are all escape codes** — bytes
   like `\033[31m` (CSI) and `\033]0;…` (OSC) interleaved with the text.

Everything cmux-linux does is one of these facts wearing an Electron costume.

---

## 🧪 Checkpoint

Answer these before moving on (every answer is in this chapter):

1. Name the **three layers** of any terminal interaction, and say which one
   xterm.js is, which one node-pty gives us, and which one bash is.
2. What are file descriptors **0, 1, and 2**, and what are their Node.js names?
   Why does `ls | cat` usually come out with **no color**?
3. In one sentence each, state the difference between a **terminal** and a
   **shell**. Why does closing a terminal window usually kill the shell even though
   they're separate things?
4. A **PTY** has two ends. Which end does the terminal emulator hold, and which end
   becomes the shell's stdin/stdout? Why can't we just use a plain **pipe**
   (`child_process.spawn`) instead?
5. Predict what `printf '\033[1;34mhello\033[0m'` shows on screen, byte group by
   byte group. What breaks if you forget the trailing `\033[0m`?
6. What is the **CSI** prefix, and what is the **OSC** prefix — and which single
   character distinguishes them? What does `\033]0;…` do?
7. In **canonical** mode, who implements backspace and echo — the program or the
   kernel? Explain, in terms of the **ECHO** flag, exactly why a password prompt
   shows nothing as you type even though it receives every keystroke.
8. When you drag a terminal bigger, list the four steps that end with `vim`
   repainting itself to fit. What signal is involved, and what web-platform event
   is it analogous to?

---

## Summary

A terminal today is a **software emulator** keeping a 1978 hardware terminal alive
so decades of programs still run. Every terminal interaction is **three layers**:
the **emulator** (screen + keyboard, e.g. xterm.js), the **TTY/PTY device** (a
kernel "wire" with a line discipline), and the **shell or program** (bash, vim) at
the far end. They communicate only in **bytes**, over the three standard streams
`stdin`/`stdout`/`stderr` (fds 0/1/2 — Node's `process.stdin/out/err`). The
**shell is just a program** running *inside* the terminal, not the terminal itself.
Because there's no real serial cable anymore, the kernel fakes one with a **PTY** —
a **master** end (held by the emulator) glued to a **slave** end (the shell's
stdio) — so unmodified programs think they're on real hardware and inherit the line
discipline (canonical editing, echo, `Ctrl-C`→SIGINT) for free. **Colors, cursor
motion, window titles, and desktop notifications are all escape codes** —
`\033[…` (CSI) and `\033]…` (OSC) — interleaved with the text. The **line
discipline** explains why your keystrokes appear (echo) and why passwords don't
(echo temporarily off), while the PTY's **size** plus the **SIGWINCH** signal keep
full-screen apps like vim drawing correctly across resizes. In cmux-linux,
**node-pty holds the master** and **xterm.js is the emulator** — everything else is
plumbing bytes between them.

## Where this shows up next
- The two-process split those layers live in → `03-electron-architecture.md`
- Moving the bytes across that split (send/onData) → `04-ipc-inter-process-communication.md` and `05-preload-and-context-isolation.md`
- Holding the **PTY master**, `write`/`onData`/`resize`, env injection → `06-node-pty.md`
- The **emulator** that parses the escape codes and paints the grid → `07-xtermjs.md`
- Scanning the stream for **OSC 9/99/777** to ring the sidebar → `12-notifications-and-osc.md`
- Every term here, defined once more in one place → `16-glossary.md`
- The full end-to-end keystroke + notification trace → `17-how-it-all-connects.md`

## Further reading
- The TTY demystified (Linus Åkesson) — the single best deep-dive on TTYs, PTYs, sessions, and signals: https://www.linusakesson.net/programming/tty/
- ANSI escape code (Wikipedia) — a complete, browsable table of CSI/SGR/OSC sequences: https://en.wikipedia.org/wiki/ANSI_escape_code
- XTerm Control Sequences (Thomas Dickey, invisible-island) — the authoritative reference for what real terminals implement: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
- `termios(3)` man page — canonical vs raw mode, the ECHO flag, and every line-discipline setting: https://man7.org/linux/man-pages/man3/termios.3.html
- `pty(7)` man page — the Linux pseudo-terminal (master/slave) interface itself: https://man7.org/linux/man-pages/man7/pty.7.html
- DEC VT100 User Guide, Chapter 3 — the 1978 primary source for the escape codes we still emit: https://vt100.net/docs/vt100-ug/chapter3.html
- node-pty — the library that hands us the PTY master in the main process: https://github.com/microsoft/node-pty
- xterm.js — the terminal emulator we render in the renderer: https://xtermjs.org/
