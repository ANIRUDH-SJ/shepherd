# Bug 04 — CLI socket test hangs forever

**Milestone:** M3 (socket API) · **Found by:** my own testing · **Status:** Fixed

> A bug in the **test**, not the app — but a great lesson, and exactly the kind of
> thing worth writing down.

## Symptom

The headless test for the `cmux` CLI (start a mock socket server, run the CLI against
it, assert the protocol) **hung** and was killed by the timeout:

```
Exit code 143            # 143 = 128 + 15 (SIGTERM) — the timeout killed it
Command timed out after 1m 0s
```

## How we debugged it

The test did three things in one Node process:
1. started a `net` mock server (async, event-loop driven),
2. ran the CLI with **`execFileSync`** (synchronous),
3. asserted on what the server received.

Reasoning through the timeline exposed a **deadlock**:

```
main process event loop
  ├─ net server listening (needs the event loop to accept + reply)
  └─ execFileSync(cmux …)   ← BLOCKS the event loop until the child exits
                                │
        child `cmux` connects ──┘ and waits for a reply…
        …but the server can't reply — the event loop is blocked by execFileSync
        → child waits forever → execFileSync waits forever → 💀
```

## Root cause

**A synchronous child call (`execFileSync`) blocked the very event loop the in-process
server needed to respond.** The CLI child was waiting on a reply that could never
come, because its server was frozen inside `execFileSync`.

## The fix

Run the CLI **asynchronously** so the event loop stays free to service the server:

```js
function run(env, args) {
  return new Promise((resolve) => {
    const child = spawn(CLI, args, { env: { ...process.env, ...env } }) // async
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('close', (code) => resolve({ code, out }))
  })
}
// server.listen(SOCK, async () => { await run(...); await run(...); ... })
```

With `spawn` + `await`, the loop keeps turning, the server replies, the CLI exits.
Result: all 6 protocol assertions passed.

## How we prevent it now

- **Rule:** never use `*Sync` child-process calls while an in-process async server
  must respond. Same process = shared event loop = deadlock risk.

## Lesson

"Hangs forever + no output" in Node is very often **event-loop starvation** — usually
a synchronous call blocking async work in the same process.
