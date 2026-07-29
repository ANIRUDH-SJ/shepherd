# 30 — Scheduling work around the startup critical path

Performance work is often described as “making code faster,” but startup is
usually a dependency problem first. If a task does not contribute to the first
useful interaction, running it early can consume event-loop time, CPU, filesystem
bandwidth, or process slots without making the product feel ready.

This chapter explains how cmux-linux moves automatic agent discovery and
workspace metadata observation behind a real first-terminal readiness boundary.
The important ideas apply to any Electron application with a critical UI path
and eventually consistent background services.

## 1. Model the outcome, not the launch event

Electron readiness is not user readiness. `app.whenReady()` means Electron can
create browser windows. A terminal application still must:

1. create and show a window;
2. bootstrap the renderer and React;
3. open and size xterm;
4. choose WebGL or software rendering;
5. subscribe to terminal output;
6. spawn a shell through node-pty; and
7. accept input and render output.

Starting every service at step zero makes the dependency graph look simple, but
it puts unrelated work in the same scheduling window.

cmux-linux now treats the graph as:

```text
Electron ready
  -> critical IPC/socket/session handlers
  -> BrowserWindow + React + xterm
  -> PTY creation + renderer frame
  -> first-terminal-ready
       -> next turn: automatic agent discovery
       -> next turn: workspace metadata discovery

PTY first output -> xterm write callback -> frame -> startup-ready
```

The two readiness names answer different questions. `first-terminal-ready`
means the terminal control and live PTY are ready for interaction.
`startup-ready` means the first PTY output passed through xterm's write queue and
the browser received a paint opportunity. A shell can be interactive before it
prints a prompt, so collapsing those facts would make the trace less useful.

## 2. Decide what must remain early

Deferral is safe only after classifying dependencies.

The PTY IPC handler must exist before `TerminalHost` calls `terminal.create()`.
Session load must exist before React derives its initial application state. The
workspace mirror and Unix socket remain early so automation and workspace
resolution retain their established startup contract.

Agent discovery and workspace metadata are observers. Neither is required to
create a shell, accept a keystroke, or draw the terminal. Their product contract
is eventual freshness:

- agent process state is sampled every 1,000 ms;
- active cwd and Git metadata are reconciled every 750 ms, with slower non-Git
  retries.

Deferring their runtime construction shifts when those initial intervals begin.
It does not disable scans, weaken process bounds, change Git execution, or hide
the Agents section.

## 3. Build a semantic readiness handshake

The renderer is the only process that knows xterm has opened and received a
frame. Main is the only process that knows the PTY factory completed. The
handshake combines both facts without sharing clocks.

`TerminalHost` performs its normal setup in this order:

```text
term.open -> fit -> renderer addon -> output subscriptions -> terminal.create
```

For the initially focused terminal, it waits for the `terminal.create()` promise
to resolve and then requests one animation frame. The frame callback calls the
preload method `startup.firstTerminalReady()`.

This is readiness-driven scheduling. A fixed `setTimeout(500)` would fire too
early on a pressured machine and waste time on a fast one. Waiting for first
shell output would be too strong: a shell may be valid but quiet, and a startup
failure would become indistinguishable from intentional silence.

The selected boundary is not “pixels reached the monitor.” Browser animation
frames are software scheduling boundaries. Hardware presentation requires a
different measurement system.

## 4. Use two layers of idempotence

React components can remount, multiple panes can exist, and future window
behavior may create another renderer. A one-shot lifecycle signal should be
safe even if more than one caller believes it won.

The preload bridge keeps `firstTerminalReadyReported`. It sends the payload-free
IPC only once in that renderer process. Main passes the event to a coordinator
whose `firstTerminalReady()` only transitions from `waiting`.

This is inexpensive defensive duplication:

```text
renderer duplicates -> stopped by preload
process/window duplicates -> stopped by main coordinator
```

The IPC carries no terminal id, path, command, or user-controlled text. It grants
no capability beyond advancing an idempotent internal lifecycle. Context
isolation remains enabled and the renderer still cannot access `ipcRenderer`
directly.

## 5. Preserve state while consumers do not exist

React mirrors `WorkspacesSync` to main throughout startup. Previously, main
immediately forwarded its agents and workspaces to live discovery runtimes.
After deferral, a sync can arrive before those runtimes exist.

Dropping it would cause two subtle bugs:

- a structured agent could be absent when automatic discovery first decides
  source precedence;
- metadata discovery could start without knowing the active surface for a
  workspace.

Queueing every snapshot is also wrong. These consumers need current state, not
an event history. `DeferredBackgroundServices.update()` stores one
`latestSync`. Each service receives the latest relevant projection when it
starts. Once live, updates are forwarded normally.

This is a common startup pattern:

```text
producer state -> latest-value latch -> late consumer
```

Use it only for replaceable state. Commands with side effects require an ordered
queue or an explicit rejection policy.

## 6. Yield without inventing a timeout

The coordinator uses `setImmediate()` to place each factory on a later Node event
loop turn. Agent discovery starts on the first turn after readiness. Metadata
starts on the following turn.

Why not start both in the readiness IPC handler? The constructors are currently
small, but keeping separate turns creates a stable scheduling boundary and
prevents future initialization work from silently becoming one large callback.
Already queued I/O and renderer IPC get opportunities between stages.

Why not `requestIdleCallback()`? The services own Node APIs such as `/proc`,
filesystem reads, timers, and child processes. Their lifecycle belongs in
Electron main, and renderer idleness does not mean the main process is idle.

`setImmediate()` does not promise a precise duration. That is the point. The
policy is dependency ordering, not “wait N milliseconds.”

## 7. Make the coordinator a small state machine

The coordinator states are:

- `waiting`: keep the latest sync; do not create observers;
- `starting`: one or two scheduled turns are pending;
- `started`: both start attempts finished and live runtimes receive updates;
- `stopped`: pending work is cancelled and runtimes are stopped.

Only `waiting -> starting` is allowed for readiness. `stop()` is idempotent from
every state. If shutdown occurs between service turns, the cancellation function
from the injected scheduler prevents the second factory from running.

Each factory is independent. If agent discovery throws, the error reporter runs
and metadata still gets its scheduled attempt. Full background readiness is
reported only if both runtimes exist. Observability callbacks are isolated so a
logging failure cannot discard a service that already started.

This failure model is fail-soft, not silent. Main logs which service failed, the
terminal remains usable, and the performance trace stays incomplete instead of
claiming both observers are active.

## 8. Keep measurement semantics stable

The diagnostic recorder gained four fixed events:

- `first-terminal-ready`;
- `agent-discovery-started`;
- `workspace-metadata-started`;
- `background-services-started`.

`startup-ready` is still timestamped at first xterm output plus a frame. The
recorder delays its single JSON emission until background services are also
active. Sorting by monotonic elapsed time means the record preserves whichever
event actually happened first.

This design avoids two misleading alternatives:

1. redefining `startup-ready` to mean “all observers started,” which would turn a
   user-facing metric into an implementation metric;
2. emitting multiple uncorrelated log lines, which makes automated collection
   and incomplete-startup diagnosis harder.

The internal trace still does not prove a speedup. Controlled external runs with
warmups, multiple samples, pressure gates, and counter-metrics remain the
acceptance test.

## 9. Understand the tradeoffs

Metadata and automatic agent presence can appear later than before. Their
maximum added delay is intentional and bounded by:

```text
time to first-terminal-ready + existing observer interval
```

The sidebar itself remains visible from startup, including its empty Agents
state. A workspace initially shows its safe restored/default identity and then
receives fresh cwd/Git metadata. This is preferable to blocking the terminal on
information that is observational.

The readiness handshake adds one IPC message and one promise/frame continuation
for the initially focused terminal. It does not add a branch to every PTY output
or xterm write when diagnostics are disabled.

## 10. Test the scheduling contract

The coordinator accepts an injected scheduler, allowing tests to advance turns
manually without real timers. Tests verify deduplication, turn separation,
latest-state replay, live forwarding, cancellation, exact stop counts, and
independent factory failure.

Contract and recorder tests verify that the new names are unique, renderer
diagnostic IPC cannot impersonate the dedicated readiness channel, terminal
readiness is recorded before background completion, and the summary emits once.

A production Electron smoke test closes the final gap. The isolated run proved:

- one visible window and a responsive Unix socket;
- a complete software-rendering performance trace;
- live project and branch updates after `cd`;
- automatic appearance and removal of a Kimi-named foreground process; and
- clean shutdown of the isolated app and display.

One smoke trace is behavioral evidence, not a benchmark distribution.

## 11. Generalize the pattern carefully

More work can move behind readiness only if its dependencies and freshness
contract are explicit. Good candidates are replaceable observations,
pre-fetches, and cache maintenance. Bad candidates include input handlers,
state restoration, authorization, crash recovery, and anything required to
render an honest initial state.

The next optimization in cmux-linux targets PTY output batching. That problem
has a different constraint: throughput can improve only if ordering, bounded
memory, interactive latency, OSC parsing, and exit flushing remain correct. It
belongs in its own branch and measurement cycle.

## Checkpoint

1. Why is Electron readiness too early to trigger observational work?
2. Which facts are guaranteed by the cmux first-terminal handshake?
3. Why is a latest-value latch correct for workspace sync but not every event?
4. What does `setImmediate()` guarantee here, and what does it deliberately not
   guarantee?
5. Why should background failure leave the performance trace incomplete?
6. Which counter-metrics would you inspect before accepting this optimization?
