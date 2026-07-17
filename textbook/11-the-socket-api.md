# Chapter 11 — The Socket API: The Backbone

> **What you'll learn**
> - Why cmux-linux needs an *external* control channel at all — and why IPC alone can't do the job
> - What a **unix domain socket** is, how it differs from a TCP/HTTP server, and how to build one with Node's `net` module
> - The **wire format** we mirror from cmux: newline-terminated JSON, `{id, method, params}` → `{id, result|error}` (basically JSON-RPC)
> - How to build the **socket server** in the main process: buffering bytes, splitting on newlines (message framing!), dispatching by `method`, replying with `{id, result}`
> - The **full method surface** — workspaces, surfaces/panes, input, sidebar status, logs, notifications, utility — grouped and explained
> - How to build the tiny **`cmux` CLI client**, and how an agent invokes it
> - How a socket message becomes **UI**: main mutates the store → `webContents.send('workspace:update')` → React re-renders
> - How **env injection** lets `cmux set-status …` run *inside* a pane target the right workspace with zero flags
> - The classic gotchas: message framing, stale socket files, method whitelisting, and file permissions
>
> **Prerequisites:** `04-ipc-inter-process-communication.md` (you must be comfortable with main↔renderer IPC) and `09-typescript-and-the-data-model.md` (you need the `Workspace`/`Pane`/`Surface` model in your head). A passing memory of Loop C from `01-the-big-picture.md` helps too.

---

## 11.1 The problem: how does something *outside* the app talk to it?

Go back to Loop C from Chapter 1 — the "cmux magic" round-trip:

```
Claude Code finishes → its hook runs `cmux notify --body "waiting..."`
  → the cmux CLI connects to the unix socket (main)
  → main marks that workspace "needs attention"
  → webContents.send("workspace-update", ...)   (IPC → renderer)
  → React lights up the sidebar row + rings the pane
  → main also fires an OS desktop notification
```

Stare at the first two lines. **Claude Code is not your app.** It's a completely
separate program — a different OS process, with its own memory, spawned by a shell
running *inside* one of your terminal panes. When that agent finishes its work and
wants to tell cmux-linux "hey, I need the human," it faces a hard wall:

- It **can't** call a React function. React lives in the renderer's Chromium
  sandbox; the agent is an unrelated Linux process.
- It **can't** use Electron IPC. `ipcRenderer` / `webContents.send` only connect
  *your app's own* main and renderer processes. They are an internal hallway, not
  a public door. An outside process has no `ipcRenderer` handle to your window.
- It **can't** just write to a shared variable. Different processes don't share
  memory.

So we need a **doorway into the running app that any process on the machine can
knock on.** That doorway is the **socket API**. It is, quite literally, the reason
the sidebar comes alive — which is why `FEATURES.md` calls it *"the backbone."*

> **🔧 In cmux-linux:** there are **two** messaging systems in this app and beginners
> constantly conflate them. Keep them separate:
>
> | System | Connects | Who uses it | Chapter |
> |---|---|---|---|
> | **Electron IPC** | main ↔ renderer (*inside* our app) | our own code | `04-ipc-inter-process-communication.md` |
> | **Unix socket API** | main ↔ *any other OS process* | agents, the `cmux` CLI, scripts | **this chapter** |
>
> The socket is the **front door** outsiders knock on. IPC is the **hallway**
> inside. A typical request comes in the front door (socket) and ends by walking
> down the hallway (IPC) to update the UI. You'll see this exact handoff in §11.8.

### Why not just an HTTP server?

You already know how to let outside processes talk to a Node program — you'd spin
up an Express server and have the agent `curl http://localhost:7777/notify`. That
*would* work. cmux (and we) deliberately don't, for four reasons:

1. **No port to allocate or collide on.** A TCP port is a global, numeric,
   machine-wide resource. Two cmux windows, or cmux and some other app, could fight
   over `:7777`. A socket is just a *file path* — we pick a unique one and never
   collide.
2. **Local-only by construction.** A unix socket has no network stack behind it.
   Nothing on your LAN, and certainly nothing on the internet, can reach it. An
   HTTP server bound to a port is at least theoretically reachable and needs you to
   think about `0.0.0.0` vs `127.0.0.1`, firewalls, and auth. The socket sidesteps
   all of that.
3. **Filesystem permissions come free.** Because the endpoint *is* a file, the OS's
   file permissions decide who may connect. `chmod 600` and only your user can talk
   to it (§11.11). No auth tokens to invent.
4. **It's faster and lighter.** No TCP/IP handshake, no HTTP parsing, no headers —
   just bytes over a kernel pipe. For thousands of tiny `set-status` calls, that
   matters.

Everything else about it, though, will feel *exactly* like writing a server — so
let's meet the socket.

---

## 11.2 Unix domain sockets 101 (for an Express developer)

A **unix domain socket** (UDS) is an inter-process communication endpoint that
looks and behaves almost exactly like a TCP socket — **except it's bound to a file
path instead of a host:port, and it never leaves the machine.**

Here's the mapping from things you know:

```
        TCP / Express server                 Unix domain socket server
        ─────────────────────                ─────────────────────────
  bind to:   host + port (0.0.0.0:7777)         a file path (/tmp/cmux-linux.sock)
  reachable: anyone who can route to the IP     only processes on THIS machine
  client:    fetch() / curl / axios             net.connect('/tmp/cmux-linux.sock')
  protocol:  HTTP (framing built in)            RAW BYTES (you frame it — §11.3)
  auth:      tokens, cookies, TLS               filesystem permissions on the file
```

If you've ever seen `/var/run/docker.sock` and used `docker` from the terminal —
that's a unix socket. The `docker` CLI connects to that file and the Docker daemon
answers. We are building the exact same shape: a **daemon** (our Electron main
process) listening on a socket file, and a **CLI** (`cmux`) that connects to it.

### The `net` module: an HTTP server minus the HTTP

Node's built-in `net` module is the low-level TCP/socket layer that `http` is built
on top of. Where Express gives you `req`/`res` objects with parsed methods, URLs,
headers, and bodies, `net` gives you a raw, bidirectional **stream of bytes** and
says "good luck." That sounds scary; it's actually liberating once you accept one
responsibility (framing, §11.3).

Here's the smallest possible UDS server and client, side by side, so the shapes
land before we add cmux semantics:

```ts
// server.ts — the "backend"
import net from 'node:net';

const server = net.createServer((socket) => {
  // `socket` is a duplex stream: readable AND writable.
  // Think of it like a single WebSocket connection.
  console.log('a client connected');

  socket.on('data', (chunk: Buffer) => {
    console.log('got bytes:', chunk.toString('utf8'));
    socket.write('hello back\n');          // reply on the same connection
  });

  socket.on('end', () => console.log('client disconnected'));
});

server.listen('/tmp/demo.sock', () => {
  console.log('listening on /tmp/demo.sock');
});
```

```ts
// client.ts — the "frontend" / CLI
import net from 'node:net';

const socket = net.connect('/tmp/demo.sock', () => {
  socket.write('ping\n');                  // send some bytes
});

socket.on('data', (chunk: Buffer) => {
  console.log('server said:', chunk.toString('utf8'));
  socket.end();                            // close the connection
});
```

Run the server, run the client, and you'll see `ping` on one side and
`hello back` on the other. **That's the whole mechanism.** No port, no HTTP, no
framework — a file path and two byte streams.

A few things to internalize from this tiny example, because every one of them
comes back:

- **`createServer((socket) => …)`** — the callback fires **once per connection**,
  handing you a `net.Socket`. If you've used the `ws` library, this is precisely
  the `wss.on('connection', (ws) => …)` shape. Each `cmux` CLI invocation opens
  one connection, sends one request, reads one reply, and closes — so this
  callback fires a lot, briefly.
- **`socket.on('data', chunk => …)`** — data arrives as `Buffer`s (raw bytes). You
  `.toString('utf8')` to get text. **Crucially, one `data` event is NOT one
  message** — it's however many bytes the kernel happened to hand you. Hold that
  thought; it's §11.3 and the #1 gotcha of the chapter.
- **`socket.write(…)`** — push bytes back down the same connection. This is our
  reply channel.
- **`server.listen(path)`** — bind. For a UDS the "address" is a filename, and
  **listening creates that file on disk.** Which leads to our first gotcha…

> **⚠️ Gotcha — the stale socket file.** When `server.listen('/tmp/cmux-linux.sock')`
> runs, Node *creates* that file. When the app exits cleanly, Node removes it. But
> if the app **crashes** (or is `kill -9`'d), the file is left behind — and the
> next launch's `listen()` throws `EADDRINUSE: address already in use`, because a
> file is already sitting at that path. The fix is to unlink it on startup before
> listening. We do this defensively in §11.4.

> **🔧 In cmux-linux:** our socket path is **`/tmp/cmux-linux.sock`**, overridable
> with the **`CMUX_SOCKET_PATH`** environment variable. cmux itself uses
> `/tmp/cmux.sock`; we pick a distinct name so both could run side by side, and the
> override lets tests and multiple windows use isolated paths. Every terminal pane
> we spawn gets `CMUX_SOCKET_PATH` injected into its env (§11.9) so the `cmux` CLI
> inside a pane always knows which socket to dial without being told.

---

## 11.3 The wire format: newline-delimited JSON (and why framing is *your* job)

We inherited the earlier warning: **one `data` event is not one message.** This is
the single most important idea in the chapter, so let's make it concrete.

A unix socket (like TCP) is a **byte stream**, not a **message stream**. The kernel
guarantees the bytes arrive *in order*, but makes **no promise about where one
`write()` ends and the next begins** by the time they reach the reader. If the CLI
does three quick writes, the server might see them as:

- three separate `data` events (the tidy case), **or**
- one `data` event with all three globbed together, **or**
- two events that split a message right down the middle.

```
  What the client writes:        What the server's 'data' events MIGHT be:

  write: {"id":1,...}\n           data #1: {"id":1,...}\n{"id":2,..     ← 1.5 messages!
  write: {"id":2,...}\n           data #2: .}\n{"id":3,...}\n           ← the rest + a whole one
  write: {"id":3,...}\n
```

This is *fundamentally different* from the tools you're used to:

- **HTTP** frames messages for you via `Content-Length` / chunked encoding — Express
  hands you a complete `req.body`.
- **WebSocket** frames messages for you — `ws.on('message', …)` gives you one whole
  message per event.
- **Raw sockets do not.** You're one layer below all of that. **You must define and
  enforce your own message boundaries.** This job is called **framing.**

The simplest, most debuggable framing on earth is **"one JSON object per line."**
Every message is a compact JSON string with **no interior newlines**, terminated by
a single `\n`. This format has a name you'll see in the wild — **NDJSON** (or
"jsonlines"). To find message boundaries you just split the incoming byte stream on
`\n`. It's human-readable (you can literally `nc -U /tmp/cmux-linux.sock` and type
JSON at it), trivial to parse, and language-agnostic.

The **shape** of each message mirrors JSON-RPC, which you can think of as
"REST-over-a-socket":

```
  Request  (client → server):   {"id": 1, "method": "set-status", "params": {...}}\n
  Success  (server → client):   {"id": 1, "result": {...}}\n
  Failure  (server → client):   {"id": 1, "error": {"code": -32601, "message": "..."}}\n
```

Field by field:

| Field | Direction | Meaning |
|---|---|---|
| `id` | request → mirrored back | A correlation number the **client** picks. The server echoes it in the reply so the client can match reply-to-request (essential if you ever pipeline several requests on one connection). Like a WebSocket request/response correlation id. |
| `method` | request | Which operation to run — e.g. `"set-status"`, `"workspace.create"`. This is your "route." |
| `params` | request | An object of arguments for that method. Like a POST body. |
| `result` | success reply | The method's return value. Present *only* on success. |
| `error` | failure reply | `{code, message}` — present *only* on failure. Mutually exclusive with `result`. |

> **🔧 In cmux-linux:** we copy cmux's wire format verbatim so our `cmux` CLI is a
> faithful clone: **newline-terminated JSON, `{id, method, params}` in, `{id, result}`
> or `{id, error}` out.** The `id` correlation and the split-`result`/`error` shape
> are the JSON-RPC bits; we don't bother with JSON-RPC's `"jsonrpc":"2.0"` version
> tag because it buys us nothing for a private, local protocol.

---

## 11.4 Building the server (main process)

Now we assemble the real thing in the Electron **main** process. It has four jobs,
in order:

1. **Bind** the socket (after unlinking any stale file).
2. **Buffer and frame** incoming bytes into whole lines (the framing from §11.3).
3. **Dispatch** each parsed message to a handler by its `method`.
4. **Reply** with `{id, result}` or `{id, error}`.

Let's build it in layers.

### Step 1 — bind, with the stale-file guard

```ts
// main/socketServer.ts
import net from 'node:net';
import fs from 'node:fs';

const SOCKET_PATH = process.env.CMUX_SOCKET_PATH ?? '/tmp/cmux-linux.sock';

export function startSocketServer() {
  // --- the stale-socket guard (see the §11.2 gotcha) ---
  // If a previous run crashed, the socket file is still on disk and listen()
  // would throw EADDRINUSE. Removing it first is safe: if a LIVE server owned
  // it, our listen() below would fail loudly and we'd know two apps are running.
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;   // ENOENT = "no such file" = fine, nothing to remove
  }

  const server = net.createServer(handleConnection);

  server.listen(SOCKET_PATH, () => {
    // Lock the file down so ONLY this user can connect (see §11.11).
    fs.chmodSync(SOCKET_PATH, 0o600);
    console.log(`[cmux] socket API listening on ${SOCKET_PATH}`);
  });

  server.on('error', (err) => {
    console.error('[cmux] socket server error:', err);
  });

  // Clean up on the way out so we don't leave a stale file behind.
  const cleanup = () => { try { fs.unlinkSync(SOCKET_PATH); } catch {} };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });

  return server;
}
```

> **⚠️ Gotcha — don't blindly unlink a live socket.** Unlinking the file removes the
> *directory entry*, not a live listener bound to it. If another cmux is genuinely
> running and owns that path, our subsequent `listen()` will still fail — which is
> the behavior we want (it tells us "already running"). The `unlinkSync` only rescues
> the *crashed-last-time* case. If you wanted to be extra careful you'd first try to
> `net.connect` to the path and only unlink if the connection is refused (proving
> no one's home), but the unlink-then-listen pattern above is the common, pragmatic
> choice.

### Step 2 — buffer and frame (the heart of it)

Each connection gets its **own** buffer, because two connections' bytes must never
mix. This is why the framing logic lives *inside* `handleConnection`:

```ts
// main/socketServer.ts (continued)
function handleConnection(socket: net.Socket) {
  socket.setEncoding('utf8');    // hand us strings, not Buffers, on 'data'
  let buffer = '';               // per-connection accumulator

  socket.on('data', (chunk: string) => {
    buffer += chunk;             // append whatever bytes just arrived

    // Pull out every COMPLETE line (a line = one message). Anything after the
    // last '\n' is a partial message; we leave it in `buffer` for next time.
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex);   // the message, sans newline
      buffer = buffer.slice(newlineIndex + 1);      // keep the remainder
      const trimmed = line.trim();
      if (trimmed === '') continue;                 // ignore blank lines
      handleMessage(trimmed, socket);
    }
    // If `buffer` still has leftover bytes here, they're an INCOMPLETE message.
    // We do nothing — the next 'data' event will append the rest and complete it.
  });

  socket.on('error', (err) => console.error('[cmux] socket connection error:', err));
}
```

Walk through the `while` loop with the nasty split from §11.3 to prove it works:

```
 buffer starts:  ""
 data #1 arrives: '{"id":1,...}\n{"id":2,..'
   buffer = '{"id":1,...}\n{"id":2,..'
   loop: found '\n' at the end of msg 1
     → handleMessage('{"id":1,...}')          ✅ msg 1 dispatched, whole
     → buffer = '{"id":2,..'                    ← partial msg 2 retained
   loop: no more '\n' → exit loop, wait for more bytes
 data #2 arrives: '.}\n{"id":3,...}\n'
   buffer = '{"id":2,..' + '.}\n{"id":3,...}\n'
          = '{"id":2,...}\n{"id":3,...}\n'
   loop: handleMessage('{"id":2,...}')          ✅ msg 2 completed & dispatched
   loop: handleMessage('{"id":3,...}')          ✅ msg 3 dispatched
   loop: buffer = '' → exit
```

Three messages recovered perfectly from two ragged chunks. **This buffer-and-split
loop is the load-bearing beam of the whole chapter.** If you internalize one code
snippet, make it this one.

### Step 3 + 4 — parse, dispatch, reply

```ts
// main/socketServer.ts (continued)

// Two tiny reply helpers keep the wire format in ONE place.
function reply(socket: net.Socket, id: unknown, result: unknown) {
  socket.write(JSON.stringify({ id, result }) + '\n');
}
function replyError(socket: net.Socket, id: unknown, code: number, message: string) {
  socket.write(JSON.stringify({ id, error: { code, message } }) + '\n');
}

async function handleMessage(line: string, socket: net.Socket) {
  // 1) Parse — a malformed line must NEVER crash the server.
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return replyError(socket, null, -32700, 'Parse error: invalid JSON');
  }

  const { id, method, params } = msg ?? {};

  // 2) Validate + whitelist (see §11.6 and the gotcha there).
  const handler = HANDLERS[method as string];
  if (typeof handler !== 'function') {
    return replyError(socket, id ?? null, -32601, `Unknown method: ${method}`);
  }

  // 3) Dispatch — run the handler, catch anything it throws.
  try {
    const result = await handler(params ?? {}, { socket });
    reply(socket, id, result);
  } catch (err: any) {
    replyError(socket, id ?? null, -32000, err?.message ?? 'Internal error');
  }
}
```

Notice the four defensive layers, each mapping to a JSON-RPC-style error code:

| Failure | Code | Why it matters |
|---|---|---|
| Bad JSON | `-32700` | A garbage byte or half a message must produce an error reply, **not** an unhandled exception that takes down the server. |
| Unknown `method` | `-32601` | This is our **method whitelist** (§11.6). Only names present in `HANDLERS` run; everything else is politely rejected. |
| Handler threw | `-32000` | A bug or bad params in one handler returns an error on *that* request; other requests keep working. |
| (Success) | — | `{id, result}`. |

`HANDLERS` is a plain object mapping method name → function. That map **is** the API
surface, and we fill it in next.

---

## 11.5 The full method surface

Here's every method we implement, grouped the way `FEATURES.md` Part 2 groups them.
Read this as the "API reference" for the socket. Each row is one key in the
`HANDLERS` map.

### Workspaces — manage sidebar entries

| Method | Params | Returns | CLI |
|---|---|---|---|
| `workspace.create` | `{name, cwd?}` | `{id, name}` | `cmux new-workspace` |
| `workspace.list` | `{}` | `{workspaces: [...]}` | `cmux list-workspaces --json` |
| `workspace.select` | `{workspaceId}` | `{ok}` | `cmux select-workspace --workspace <id>` |
| `workspace.current` | `{}` | `{workspaceId, name}` | `cmux current-workspace` |
| `workspace.close` | `{workspaceId}` | `{ok}` | `cmux close-workspace --workspace <id>` |

### Surfaces / panes — the tiling (see `10-tiling-and-layout.md`)

| Method | Params | Returns | CLI |
|---|---|---|---|
| `surface.split` | `{direction: 'left'\|'right'\|'up'\|'down', surfaceId?}` | `{surfaceId}` | `cmux new-split right` |
| `surface.list` | `{workspaceId?}` | `{surfaces: [...]}` | `cmux list-surfaces --json` |
| `pane.surfaces` | `{paneId}` | `{surfaces: [...]}` | — |
| `surface.focus` | `{surfaceId}` | `{ok}` | `cmux focus-panel --panel <id>` |

### Input — drive a pane programmatically

| Method | Params | Returns | CLI |
|---|---|---|---|
| `surface.send_text` | `{surfaceId?, text}` | `{ok}` | `cmux send "npm test"` |
| `surface.send_key` | `{surfaceId?, key}` | `{ok}` | `cmux send-key enter` |

These reach into the target pane's **node-pty** process and `pty.write(...)` the
bytes — exactly Loop A from Chapter 1, but triggered from outside instead of by a
keystroke. `send_key` maps friendly names (`enter`, `tab`, `ctrl-c`) to their
control bytes (`\r`, `\t`, `\x03`).

### Sidebar status — the pills and progress bar

| Method | Params | Returns | CLI |
|---|---|---|---|
| `set-status` | `{workspaceId?, key, label, color?, icon?}` | `{ok}` | `cmux set-status build passing --color green` |
| `clear-status` | `{workspaceId?, key?}` | `{ok}` | `cmux clear-status build` |
| `list-status` | `{workspaceId?}` | `{status: [...]}` | `cmux list-status --json` |
| `set-progress` | `{workspaceId?, value, label?}` | `{ok}` | `cmux set-progress 0.4 --label "building"` |
| `clear-progress` | `{workspaceId?}` | `{ok}` | `cmux clear-progress` |

### Logs — a per-workspace activity feed

| Method | Params | Returns | CLI |
|---|---|---|---|
| `log` | `{workspaceId?, message, level?}` | `{ok}` | `cmux log "tests started" --level progress` |
| `clear-log` | `{workspaceId?}` | `{ok}` | `cmux clear-log` |
| `list-log` | `{workspaceId?}` | `{logs: [...]}` | `cmux list-log --json` |

### Notifications — the attention system (the star of `12-notifications-and-osc.md`)

| Method | Params | Returns | CLI |
|---|---|---|---|
| `notification.create` | `{workspaceId?, title, body?, color?}` | `{id}` | `cmux notify --title "Claude" --body "waiting for input"` |
| `notification.list` | `{workspaceId?}` | `{notifications: [...]}` | `cmux list-notifications --json` |
| `notification.clear` | `{workspaceId?, notificationId?}` | `{ok}` | `cmux clear-notifications` |

### Utility — liveness and introspection

| Method | Params | Returns | CLI |
|---|---|---|---|
| `ping` | `{}` | `{pong: true}` | `cmux ping` |
| `capabilities` | `{}` | `{version, methods: [...]}` | `cmux capabilities --json` |
| `identify` | `{}` | `{workspaceId, surfaceId}` | `cmux identify` |

`ping` is a liveness check ("is the app up?"). `capabilities` lets a client
feature-detect which methods this version supports — you'll appreciate it the first
time an old CLI talks to a new app. `identify` echoes back **who the caller is** —
the workspace/surface resolved from its env or flags — which is how `cmux identify`
inside a pane prints "you are in workspace ws_42."

> **🔧 In cmux-linux:** notice how the params column keeps repeating an *optional*
> `workspaceId?` (and sometimes `surfaceId?`). That optionality is the whole point of
> §11.9: when a command runs inside a pane, the CLI fills those in from the injected
> env, so agents almost never pass them explicitly. `cmux set-status build passing`
> "just works" and targets the pane's own workspace.

---

## 11.6 The dispatch table (whitelisting is not optional)

Here's a representative slice of the `HANDLERS` map. Each handler is a pure-ish
function: it takes `params`, mutates the store, and returns a plain object that
becomes `result`. The store (`workspaceStore`) is the same in-memory
`Window → Workspace → …` model from `09-typescript-and-the-data-model.md`, plus a
`broadcast()` that pushes to the renderer (§11.8).

```ts
// main/socketHandlers.ts
import { workspaceStore } from './store';
import { broadcastWorkspace } from './ipcBridge';

type Ctx = { socket: import('node:net').Socket };
type Handler = (params: any, ctx: Ctx) => unknown | Promise<unknown>;

export const HANDLERS: Record<string, Handler> = {
  // --- utility ---
  'ping': () => ({ pong: true }),

  'capabilities': () => ({
    version: '0.1.0',
    methods: Object.keys(HANDLERS),   // self-describing!
  }),

  'identify': (params) => {
    const ws = resolveWorkspace(params);         // env/flag resolution — §11.9
    return { workspaceId: ws.id, surfaceId: params.surfaceId ?? null };
  },

  // --- sidebar status ---
  'set-status': (params) => {
    const ws = resolveWorkspace(params);
    // upsert a status pill keyed by `key`
    const existing = ws.status.find((s) => s.key === params.key);
    const pill = {
      key: params.key,
      label: params.label,
      color: params.color ?? 'gray',
      icon: params.icon,
    };
    if (existing) Object.assign(existing, pill);
    else ws.status.push(pill);

    broadcastWorkspace(ws);           // ← push to the renderer over IPC (§11.8)
    return { ok: true };
  },

  'clear-status': (params) => {
    const ws = resolveWorkspace(params);
    ws.status = params.key ? ws.status.filter((s) => s.key !== params.key) : [];
    broadcastWorkspace(ws);
    return { ok: true };
  },

  // --- notifications (full detail in Chapter 12) ---
  'notification.create': (params) => {
    const ws = resolveWorkspace(params);
    const notif = {
      id: `n_${Date.now()}`,
      title: params.title,
      body: params.body ?? '',
      color: params.color,
      ts: Date.now(),
    };
    ws.notifications.push(notif);
    markWorkspaceAttention(ws.id, notif);   // ← the ring/flash pipeline — Chapter 12
    return { id: notif.id };
  },

  // --- input ---
  'surface.send_text': (params) => {
    const surface = resolveSurface(params);
    ptyFor(surface).write(params.text);     // Loop A, triggered externally
    return { ok: true };
  },

  // ...workspace.*, surface.*, log*, etc. follow the same shape...
};
```

Two design rules make this table safe and pleasant:

1. **Every handler returns a plain serializable object** (`{ok: true}`,
   `{id: ...}`). That object becomes `result` verbatim. Handlers never touch the
   socket directly — the framing/reply lives entirely in `handleMessage` (§11.4).
2. **The map IS the whitelist.** Because `handleMessage` only runs `method`s that
   exist as keys here, there is no way for a caller to invoke anything we didn't
   explicitly expose. There's no `eval`, no dynamic method construction.

> **⚠️ Gotcha — never dispatch to arbitrary strings.** A tempting-but-dangerous
> shortcut is `store[msg.method](msg.params)` or `this[msg.method]()`. That lets a
> malicious or buggy caller reach *any* property/method on the object — including
> `constructor`, prototype pollution, or internal helpers you never meant to expose.
> **Always dispatch through an explicit allow-list object** whose keys are exactly
> the public methods, as above. Treat every field of an incoming message as hostile
> input — it came in through the front door from a process you don't control.

---

## 11.7 The `cmux` CLI client

The server is only half the story. Agents don't speak the socket protocol directly —
they run a friendly command called **`cmux`**. That CLI is a *tiny* Node script whose
entire job is: **parse argv → build one `{id, method, params}` object → connect,
write one line, read one line, print it, exit.** It's the `curl` to our server's
Express.

Here's a compact but complete version:

```ts
#!/usr/bin/env node
// bin/cmux.ts — the CLI client agents actually invoke
import net from 'node:net';

const SOCKET_PATH = process.env.CMUX_SOCKET_PATH ?? '/tmp/cmux-linux.sock';

// --- 1) translate the human command into a {method, params} ---
function buildRequest(argv: string[]): { method: string; params: any } {
  const [cmd, ...rest] = argv;

  // Pull out --flags into an object, leaving positionals behind.
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const name = rest[i].slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) { flags[name] = next; i++; }
      else flags[name] = true;             // boolean flag, e.g. --json
    } else {
      positionals.push(rest[i]);
    }
  }

  // Default the workspace/surface from the injected env (§11.9) so an in-pane
  // command needs no --workspace flag.
  const workspaceId = (flags.workspace as string) ?? process.env.CMUX_WORKSPACE_ID;
  const surfaceId   = (flags.surface   as string) ?? process.env.CMUX_SURFACE_ID;

  switch (cmd) {
    case 'set-status':                       // cmux set-status <key> <label> --color <c>
      return { method: 'set-status',
        params: { workspaceId, key: positionals[0], label: positionals[1], color: flags.color } };

    case 'notify':                           // cmux notify --title <t> --body <b>
      return { method: 'notification.create',
        params: { workspaceId, title: flags.title, body: flags.body, color: flags.color } };

    case 'send':                             // cmux send "npm test"
      return { method: 'surface.send_text', params: { surfaceId, text: positionals[0] + '\n' } };

    case 'ping':
      return { method: 'ping', params: {} };

    // ...one case per subcommand...
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

// --- 2) send it and print the reply ---
function main() {
  const { method, params } = buildRequest(process.argv.slice(2));
  const request = { id: 1, method, params };

  const socket = net.connect(SOCKET_PATH, () => {
    socket.write(JSON.stringify(request) + '\n');   // ONE line, newline-terminated
  });

  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex === -1) return;                // reply not complete yet — wait
    const line = buffer.slice(0, newlineIndex);
    const reply = JSON.parse(line);

    if (reply.error) {
      console.error(`error ${reply.error.code}: ${reply.error.message}`);
      process.exit(1);
    }
    if ('--json' in params) console.log(JSON.stringify(reply.result));
    else console.log(reply.result?.ok ? 'ok' : JSON.stringify(reply.result));
    socket.end();
    process.exit(0);
  });

  socket.on('error', (err: any) => {
    // The socket file is missing/refused → the app isn't running.
    console.error(`cmux: cannot reach cmux-linux at ${SOCKET_PATH} (${err.code})`);
    process.exit(1);
  });
}

main();
```

Notice that the **client buffers too** (`buffer += chunk`, look for `'\n'`). The
same framing rule applies in both directions — a reply could arrive split across
chunks just as a request could. Beginners write robust servers and then forget the
client is subject to the exact same byte-stream physics.

### How an agent invokes it

Agents can call the public CLI directly, and supported providers can publish
structured lifecycle events through installed hooks/plugins:

```bash
cmux integrations setup codex
cmux integrations setup claude
cmux integrations setup opencode
cmux integrations setup all
```

Codex and Claude Code configurations receive guarded command hooks of this form:

```sh
command -v cmux >/dev/null 2>&1 && cmux agent-hook <provider>
```

The provider sends event JSON on stdin. The internal `agent-hook` command maps a
tool call, permission request, completion, failure, or session event into
`agent-report` / `agent-clear`, then uses this chapter's socket exactly like any
other client. OpenCode uses a managed plugin to call the same CLI contract.

Manual `cmux notify …` and `cmux set-status …` commands still use the original
explicit notification/status path. `cmux hooks setup` remains a compatibility
alias for Claude Code lifecycle setup.

Current agent queries use the same request/reply framing:

| Method           | Important params                                       | Returns                                                    |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `list-agents`    | workspace plus provider/state/detail/exact filters     | bounded records, match count, truncation flag, and summary |
| `agent-snapshot` | the same filters, `updatedAfter`, and `limit`           | versioned workspace and current-agent bootstrap            |
| `focus-agent`    | `agentId`                                              | `{ok: true}` after routing exact terminal focus            |
| `wait-agent`     | `agentId`, semantic state list, and bounded timeout     | matching current record or timeout error                   |

Query limits default to 200 and cannot exceed 1,000. `matched` counts the full
filtered set while `agents` is the newest bounded subset, so clients can detect
truncation without receiving an unbounded response. See Chapter 19 for the full
query model and lifecycle semantics.

There is still **no polling and no shared state file** in the reporting path. A
provider event is pushed through the socket and then reduced into UI state. Read
Chapter 19 for the semantic state model, identity, ordering, focus/wait controls,
and provider-specific setup.

> **🔧 In cmux-linux:** the `cmux` binary is shipped inside the app and placed on the
> user's `PATH` (or the hook uses its absolute path). Because it reads
> `CMUX_SOCKET_PATH`/`CMUX_WORKSPACE_ID` from the environment we inject into every
> pane (§11.9), the *same* command behaves correctly whether it's run by a hook, by
> the user typing it, or by a script — it always resolves to "this pane's workspace,
> this app's socket."

---

## 11.8 From socket message to pixels: the IPC handoff

We've now got a message in the door and a handler that mutated the store. But the
**store lives in the main process**, and the **sidebar lives in the renderer**. The
UI won't change until we walk the internal hallway — Electron IPC (Chapter 4).

Here's the full path, and it's worth seeing all three legs at once:

```
  OUTSIDE PROCESS            MAIN PROCESS                         RENDERER PROCESS
  ───────────────            ────────────                         ────────────────
  agent runs                 socket server receives the line
  `cmux set-status …`  ─sock─► parse → dispatch → HANDLERS['set-status']
                                 mutates workspaceStore (the pill)
                                 broadcastWorkspace(ws):
                                   mainWindow.webContents
                                     .send('workspace:update', ws) ──IPC──► window.api.onWorkspaceUpdate(cb)
                                                                             → React setState
                                                                             → sidebar re-renders 🎉
      ▲ front door (§11.1)         ▲ store mutation (§11.6)          ▲ hallway = IPC (Chapter 4)
```

The `broadcastWorkspace` helper is thin — it's the bridge between the two systems:

```ts
// main/ipcBridge.ts
import { BrowserWindow } from 'electron';

export function broadcastWorkspace(ws: Workspace) {
  // Serialize the (possibly circular-free) workspace and push to EVERY window.
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('workspace:update', serializeWorkspace(ws));
  }
}
```

And on the renderer side, the preload bridge (Chapter 5) exposed a listener, which a
React hook subscribes to:

```ts
// renderer/hooks/useWorkspaces.ts
import { useEffect, useState } from 'react';

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  useEffect(() => {
    // window.api.onWorkspaceUpdate came through the contextBridge (Chapter 5).
    const off = window.api.onWorkspaceUpdate((ws: Workspace) => {
      setWorkspaces((prev) => {
        const i = prev.findIndex((w) => w.id === ws.id);
        if (i === -1) return [...prev, ws];
        const next = [...prev];
        next[i] = ws;                 // replace → React re-renders that row
        return next;
      });
    });
    return off;                        // unsubscribe on unmount
  }, []);

  return workspaces;
}
```

This is ordinary React — a subscription in `useEffect`, `setState` on each push, the
component re-renders. If you've ever wired a WebSocket into React state, this is the
identical pattern; the only twist is that the "WebSocket" is Electron IPC and the
*original* trigger came from a unix socket one hop upstream.

> **🔧 In cmux-linux:** the channel name is **`workspace:update`** and it carries the
> *whole updated workspace object* (not a diff). Sending the full object keeps the
> renderer a dumb, stateless mirror of the main-process store — the store is the
> single source of truth, the renderer just paints the latest snapshot. This is the
> same "server owns state, client renders it" split you use on the web.

---

## 11.9 Env injection: why in-pane commands "just know" their workspace

Look again at the CLI in §11.7: it defaults `workspaceId` from
`process.env.CMUX_WORKSPACE_ID`. Where does that come from? **We put it there when we
spawned the pane's shell.**

When the main process creates a terminal pane, it spawns the shell with node-pty
(Chapter 6) and injects three environment variables into that shell's environment:

```ts
// main/spawnPane.ts
import * as pty from 'node-pty';

function spawnPane(workspace: Workspace, surface: Surface) {
  const shell = process.env.SHELL ?? '/bin/bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cwd: workspace.cwd,
    env: {
      ...process.env,                                  // inherit the user's env
      CMUX_WORKSPACE_ID: workspace.id,                 // "this pane belongs to ws_42"
      CMUX_SURFACE_ID:  surface.id,                    // "...surface sf_7"
      CMUX_SOCKET_PATH: process.env.CMUX_SOCKET_PATH   // "...talk to me here"
                        ?? '/tmp/cmux-linux.sock',
    },
  });
  return ptyProcess;
}
```

Because a child process **inherits** its parent's environment, every command the
user (or an agent) runs inside that pane sees these variables. So:

```
  Inside pane for workspace ws_42:
    $ echo $CMUX_WORKSPACE_ID
    ws_42
    $ cmux set-status build passing --color green
      → CLI reads CMUX_WORKSPACE_ID=ws_42 from its own env
      → sends { method:'set-status', params:{ workspaceId:'ws_42', key:'build', ... } }
      → the RIGHT workspace's pill turns green, with zero flags typed
```

This is the quiet magic that makes the whole system ergonomic. An agent's hook can
be the dumb one-liner `cmux notify --body "waiting"` and it *automatically* targets
the correct sidebar row, because the pane it runs in was born knowing its identity.

> **⚠️ Gotcha — env injection isn't retroactive.** These variables are baked in at
> `pty.spawn` time. A shell that was already running before cmux started (e.g. you
> `ssh`'d somewhere and `cmux` isn't in that env) won't have them, and `cmux` there
> will fall back to defaults or need explicit `--workspace`/`--socket` flags. This is
> also why moving a surface between panes doesn't magically change its
> `CMUX_SURFACE_ID` — the value is frozen at spawn. For v1 that's fine; just know the
> env is a *snapshot*, not a live binding.

---

## 11.10 End-to-end worked example: `cmux set-status build passing --color green`

Let's trace one real invocation through every layer we've built. This is the payoff —
the whole backbone in a single flip-book.

**Setup:** the app is running; a pane exists for workspace `ws_42`; its shell was
spawned with `CMUX_WORKSPACE_ID=ws_42` and `CMUX_SOCKET_PATH=/tmp/cmux-linux.sock`.

**① The user (or agent) runs, inside that pane:**

```bash
cmux set-status build passing --color green
```

**② The CLI (`bin/cmux.ts`, §11.7) parses argv:**

```
  cmd         = "set-status"
  positionals = ["build", "passing"]
  flags       = { color: "green" }
  workspaceId = process.env.CMUX_WORKSPACE_ID = "ws_42"   ← from env injection (§11.9)
```

and builds the request object:

```json
{ "id": 1, "method": "set-status",
  "params": { "workspaceId": "ws_42", "key": "build", "label": "passing", "color": "green" } }
```

**③ The CLI connects to `/tmp/cmux-linux.sock` and writes exactly one line:**

```
{"id":1,"method":"set-status","params":{"workspaceId":"ws_42","key":"build","label":"passing","color":"green"}}\n
```

**④ The server (§11.4) receives bytes, buffers, splits on `\n`,** yielding one
complete line, `JSON.parse`s it, looks up `HANDLERS['set-status']` (found — it's
whitelisted), and calls it.

**⑤ The handler (§11.6) mutates the store:** it finds workspace `ws_42`, upserts a
status pill `{key:'build', label:'passing', color:'green'}` into `ws.status`, then
calls `broadcastWorkspace(ws)`.

**⑥ `broadcastWorkspace` (§11.8) pushes over IPC:**
`webContents.send('workspace:update', ws_42)`.

**⑦ The renderer's `useWorkspaces` hook (§11.8) receives it,** replaces `ws_42` in
React state, and the sidebar re-renders — a **green "passing" pill** now sits under
the workspace's name.

**⑧ The server replies** `{"id":1,"result":{"ok":true}}\n`; the CLI reads it, prints
`ok`, and `process.exit(0)`.

```
 pane shell ──① cmux set-status build passing --color green
    │
    ▼ ② parse argv + read $CMUX_WORKSPACE_ID
 cmux CLI  ──③ {"id":1,"method":"set-status",...}\n──► /tmp/cmux-linux.sock
                                                          │
                                              ④ buffer→split→parse→dispatch
                                                          ▼
                                              ⑤ HANDLERS['set-status']  ── mutate store (ws_42.status)
                                                          │
                                              ⑥ webContents.send('workspace:update', ws_42)
                                                          ▼  (IPC hallway — Chapter 4)
                                              ⑦ React: green "passing" pill renders 🎉
                                                          │
                                              ⑧ reply {"id":1,"result":{"ok":true}}\n ──► CLI prints "ok", exits 0
```

Eight steps, three processes, two messaging systems (socket + IPC), and every idea
in the chapter used exactly once. Read it top to bottom until it feels inevitable.

---

## 11.11 Gotchas, gathered

We've hit these in context; here they are in one place for when you're debugging.

**1. Message framing — buffer and split on `\n`, always.** A single `data` event may
contain a *partial* message, *multiple* messages, or a message *plus part of the
next*. Never `JSON.parse(chunk.toString())` directly — it works in dev with tiny
messages and shatters under load. Use the accumulate-and-split loop (§11.4), on both
server **and** client.

**2. Stale socket file after a crash.** `listen()` throws `EADDRINUSE` if the file
already exists. `fs.unlinkSync(SOCKET_PATH)` (ignoring `ENOENT`) before listening,
and unlink again on `exit`/`SIGINT` (§11.4). Symptom if you forget: the app won't
start after a hard kill, complaining the address is in use.

**3. Method whitelisting.** Dispatch only through an explicit `HANDLERS` map; never
index an object by the raw `method` string (§11.6). Every incoming field is hostile
input from a process you don't control.

**4. Socket file permissions.** `server.listen` creates the file with your umask's
default perms, which may let *other local users* connect. Since the API can spawn
shells and send keystrokes into your panes, that's a real risk on a shared machine.
`fs.chmodSync(SOCKET_PATH, 0o600)` right after `listen` restricts connect access to
your user (§11.4). On single-user desktops it's belt-and-suspenders; on shared
hosts it's essential.

**5. Don't let a bad message kill the server.** Wrap `JSON.parse` and each handler in
`try/catch` and turn failures into `{id, error}` replies (§11.4). One malformed line
should never take down the door for everyone.

**6. Reply on the same connection, then let the client close it.** Each `cmux`
invocation is request→reply→done. The server writes the reply and keeps the socket
open; the *client* calls `socket.end()` after reading. Don't have the server slam the
connection shut before the reply flushes.

---

## 🧪 Checkpoint

Answer these before moving on (everything's in this chapter):

1. An agent process running inside a pane wants to update the sidebar. Why can't it
   just use Electron IPC or call a React function? What does it use instead?
2. Name three concrete reasons we chose a **unix domain socket** over an Express HTTP
   server on a localhost port.
3. A single `socket.on('data')` event fires with the bytes
   `{"id":1,...}\n{"id":2,..`. What must your code do, and what does it *keep* for
   the next event?
4. Write the wire-format shapes for (a) a request, (b) a success reply, (c) an error
   reply. Which field correlates a reply to its request?
5. Why is dispatching via an explicit `HANDLERS` map safer than
   `store[msg.method](msg.params)`?
6. You run `cmux set-status build passing --color green` inside a pane and never pass
   `--workspace`. How does the right workspace get updated anyway? Name the exact env
   var and where it was set.
7. After a handler mutates the store, what two-word Electron mechanism carries the
   change to the sidebar, and what channel name do we use?
8. The app won't start after you `kill -9`'d it — `EADDRINUSE`. What happened and
   what's the one-line fix?

---

## Summary

The socket API is the **front door into the running app for any process on the
machine** — the only way an outside agent can drive the UI, because IPC is internal
and processes don't share memory. We build it as a **unix domain socket** (a
`net.createServer` bound to the file `/tmp/cmux-linux.sock`, override via
`CMUX_SOCKET_PATH`) — like a TCP server, but local-only, port-free, and secured by
file permissions. Because a socket is a raw **byte stream**, we own **framing**:
messages are **newline-terminated JSON**, and the server must **buffer incoming
bytes and split on `\n`** to recover whole messages. Each message is JSON-RPC-ish —
`{id, method, params}` in, `{id, result}` or `{id, error}` out — dispatched through
an explicit, whitelisted `HANDLERS` map, one entry per method across workspaces,
surfaces/panes, input, status, logs, notifications, and utility. The tiny **`cmux`
CLI** turns a human command into one JSON line, and agents call it from hooks. A
handled message mutates the main-process store and then hands off to the **IPC
hallway** — `webContents.send('workspace:update', ws)` → React re-renders. Finally,
**env injection** (`CMUX_WORKSPACE_ID`/`CMUX_SURFACE_ID`/`CMUX_SOCKET_PATH`) baked
into each pane's shell lets in-pane commands target the right workspace with no
flags. Master the buffer-and-split loop and the whitelist dispatch and you own the
backbone.

## Where this shows up next
- The internal IPC hop this chapter hands off to → `04-ipc-inter-process-communication.md`
- The `pty.spawn` + env injection that powers in-pane targeting → `06-node-pty.md`
- The React hooks that consume `workspace:update` → `08-react-in-this-app.md`
- The `Workspace`/`Pane`/`Surface` types every handler mutates → `09-typescript-and-the-data-model.md`
- `surface.split`/`surface.focus` acting on the layout tree → `10-tiling-and-layout.md`
- The notification pipeline `notification.create` feeds → `12-notifications-and-osc.md`
- Persisting the store the socket mutates → `13-session-persistence.md`
- The full keystroke-and-notification synthesis → `17-how-it-all-connects.md`

## Further reading
- Node `net` module (unix sockets, `createServer`, `connect`): https://nodejs.org/api/net.html
- JSON-RPC 2.0 spec (the family our wire format belongs to): https://www.jsonrpc.org/specification
- NDJSON / jsonlines (our line-delimited framing): https://jsonlines.org/
- Unix domain sockets, background: https://man7.org/linux/man-pages/man7/unix.7.html
- cmux's own API/CLI docs (our reference): https://cmux.com/docs/api
- Our `FEATURES.md` Part 2 (the method surface) and `ROADMAP.md` M3/M5 (build order)
