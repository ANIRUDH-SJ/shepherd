# M21 — Terminal Memory and Lifecycle Ownership

## 1. The goal

A terminal is more than one shell process. One surface connects a React
component, xterm, addons, browser listeners, preload IPC listeners, a main-process
PTY, output flow control, OSC state, and an inspection capture. Closing the UI
must release that entire graph.

Before this milestone, normal React unmount did most of the work, but main trusted
terminal IDs without checking which renderer sent input, resize, acknowledgement,
or disposal messages. Main also retained PTYs if a renderer crashed before its
cleanup effect ran.

This milestone gives each terminal an explicit renderer owner, releases all PTYs
when that owner disappears, makes retained limits visible in code, adds
content-free diagnostics, and measures real 1/2/4/8-terminal scaling plus
repeated close behavior.

## 2. Files changed

```text
src/main/
├── pty.ts
├── terminalInspection.ts
├── terminalInspection.test.ts
├── terminalOutputBatcher.ts
├── terminalOutputBatcher.test.ts
├── terminalOwnership.ts
└── terminalOwnership.test.ts
src/renderer/src/components/
└── TerminalHost.tsx
src/shared/
├── terminalMemory.ts
└── terminalMemory.test.ts
benchmarks/
├── terminalLifecycleBenchmark.ts
├── terminalLifecycleBenchmarkLib.ts
├── terminalLifecycleBenchmarkLib.test.ts
└── results/2026-07-30-terminal-memory-lifecycle.md
```

`package.json` registers the new tests and the `benchmark:lifecycle` command.

## 3. `TerminalOwnershipRegistry` models the missing relationship

`src/main/terminalOwnership.ts` is generic so its race rules can be tested
without importing Electron or spawning a shell:

```ts
TerminalOwnershipRegistry<Owner, Terminal>
```

It stores two indexes:

- terminal ID → exact owner and terminal value;
- owner object → terminal-ID set and one unsubscribe function.

`add()` refuses duplicate IDs. The first terminal for an owner installs one
owner-loss subscription; later terminals reuse it. `getOwned(id, owner)` returns
a terminal only when object identity matches. `remove(id, expected)` optionally
checks the exact terminal value, so delayed cleanup for an old terminal cannot
remove a replacement that reused the same stable surface ID.

When an owner disappears, `releaseOwner()` first removes the owner and all its
registry records, then calls `onOwnerLost` for each terminal. Removing registry
state first makes reentrant cleanup harmless. Each callback and unsubscribe is
contained independently, so one broken PTY cannot retain the others.

`terminalOwnership.test.ts` covers:

- one listener serving multiple terminals;
- cross-owner rejection;
- expected-value removal;
- complete owner release;
- callback-failure containment;
- last-terminal listener teardown;
- ID replacement after release;
- stale old-owner cleanup; and
- idempotent clear.

## 4. `pty.ts` enforces ownership at every IPC boundary

`pty.ts` owns a registry keyed by Electron `WebContents`. Its
`subscribeTerminalOwnerLoss()` attaches one-shot listeners for both
`destroyed` and `render-process-gone`. The registry returns one combined
unsubscribe function.

Creation records the `event.sender` as the owner. Input, output acknowledgement,
resize, and disposal now call:

```ts
terminals.getOwned(id, event.sender)
```

An unknown or foreign sender becomes a no-op. Input activity is recorded only
after authorization succeeds, so rejected messages cannot affect discovery
timing either. Creation checks `has(id)` separately from
`getOwned(id, sender)`: the current owner may intentionally replace its own
terminal, but another renderer receives an error instead of killing the existing
PTY.

Every cleanup route carries an explicit reason:

- `disposed` for normal renderer unmount;
- `exited` for natural shell exit;
- `replaced` for defensive same-ID creation;
- `owner-lost` for renderer destruction or crash; and
- `shutdown` for application quit.

`disposeTerminal()` tears down node-pty subscriptions, optionally drains pending
output, disposes the batcher, kills the PTY, performs expected-value registry
removal, drops inspection state, and reports the new aggregate count. Natural
exit checks the exact `TerminalRec` before acting, which prevents an old exit
callback from touching a replacement.

`killAllTerminals()` clears registry ownership and its renderer listeners before
iterating the returned records. Shutdown therefore cannot reenter live
ownership state.

## 5. Retention bounds are code, not library folklore

`src/shared/terminalMemory.ts` defines:

```ts
TERMINAL_SCROLLBACK_LINES = 1_000
```

`TerminalHost.tsx` passes that value directly to xterm. This preserves the
previous library-default behavior while making review and future configuration
intentional.

Other existing bounds remain:

- 256 KiB inspection capture per terminal;
- 8 KiB incomplete OSC tail;
- 32 KiB output batch target;
- 128 KiB normal in-flight output window; and
- 256/64 KiB PTY pause/resume watermarks.

React cleanup still cancels the startup frame, disconnects `ResizeObserver`,
removes both window listeners, disposes xterm input and preload IPC
subscriptions, requests main-process disposal, disposes xterm and its addons,
and clears its ref.

## 6. Diagnostics report resources without terminal content

Diagnostics are enabled only by the exact value:

```sh
SHEPHERD_MEMORY_DIAGNOSTICS=1
```

Every other value leaves the normal path at one cached boolean check.
`reportTerminalMemory()` emits one `[shepherd:memory]` JSON object only at lifecycle
boundaries. It contains:

- terminal and owner counts;
- inspection terminal count, retained bytes, and cumulative dropped bytes;
- pending and in-flight output bytes; and
- paused-terminal count.

It contains no terminal ID, text, input, command, argv, cwd, environment value,
or process identity. Logging failures are caught because diagnostics must never
break shell creation or cleanup.

`terminalInspectionMemorySnapshot()` totals existing capture buffers without
copying their content. `TerminalOutputBatcher.memorySnapshot()` exposes numeric
queue state. Their tests prove acknowledgement and disposal return measured
bytes to zero and inspection removal releases retained buffers.

## 7. The lifecycle benchmark drives the real product

`terminalLifecycleBenchmark.ts` launches fresh unpacked production builds with
private XDG directories and Unix sockets. It uses the public socket protocol to
create real workspaces, which creates one real PTY per terminal. Each run:

1. settles and samples the complete marked process tree at 1, 2, 4, and 8 PTYs;
2. groups PSS/RSS/private/swap memory by sanitized process role;
3. repeatedly closes from eight terminals back to one;
4. checks the candidate's latest content-free resource snapshot; and
5. terminates only the directly spawned root and its captured descendants.

Direct-child PID identity is the cleanup root proof because Chromium can sanitize
environment markers. The harness records `/proc` start ticks and rechecks them
before `SIGKILL`, preventing a reused PID from receiving a signal.

`terminalLifecycleBenchmarkLib.ts` validates diagnostic JSON, classifies safe
process roles, summarizes robust level samples, calculates the 1→8 slope, and
detects strictly increasing recovery sequences. Pure tests cover malformed
records, direct-child ownership, role fallback, medians, slopes, and recovery
classification.

## 8. What the measurements mean

The pressure-qualified matched run found about 325 MiB fixed PSS for the complete
Electron tree and roughly 4.7–5.0 MiB per additional terminal. Process counts
were exactly 7/8/10/14 at 1/2/4/8 terminals: six fixed Electron processes plus
one shell per terminal.

All 64 checked candidate one-terminal recovery points returned to:

```text
terminal=1, owner=1, inspection=1,
pending=0, in-flight=0, paused=0
```

PSS returned to an allocator high-water plateau rather than the cold value. The
pre-feature build showed the same warm-up steps, and after 30 cycles candidate
PSS was 1.5 MiB lower than baseline. The stable shell memory, exact resource
counts, identical process count, and matched baseline shape distinguish reserved
Electron pages from retained PTYs.

The host had 74.9% swap use, so absolute numbers remain pilot evidence. See the
benchmark report for the full caveat and tables.

After final code review, the production bundle was rebuilt at `eeadbdd` and
exercised in one short 1/2/4/8-terminal smoke. It reported no failures, process
counts of 7/8/10/14, and exact managed-resource recovery at the cold checkpoint
and after all three close cycles. That smoke validates the shipped revision; the
longer matched run remains the statistical comparison.

## 9. Checkpoint

You should now be able to explain:

1. why a stable terminal ID is not an authorization boundary;
2. why expected-value removal prevents stale cleanup races;
3. why one owner listener is better than one listener per terminal;
4. which cleanup paths can end a PTY and why they are idempotent;
5. why resource counts and PSS answer different questions;
6. why allocator high-water memory need not be a live-object leak; and
7. how the benchmark proves process ownership before signaling anything.
