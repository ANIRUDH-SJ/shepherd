# 33 — Terminal Memory, Ownership, and Lifecycle

A terminal surface is a distributed resource graph. The visible rectangle lives
in a Chromium renderer, its shell lives behind a PTY in Electron main, and the
preload bridge connects them. Memory and cleanup bugs appear when we think of
that graph as “one component” instead of several owners with different failure
modes.

This chapter develops a lifecycle model for that graph. It explains renderer
authorization, stale cleanup races, bounded retention, content-free diagnostics,
multi-process memory measurement, failure handling, alternatives, and the
difference between live leaks and allocator high-water pages.

## 1. Inventory the whole terminal

One mounted cmux-linux terminal owns resources in three processes.

### Renderer

- one xterm `Terminal`;
- a `FitAddon` and optional `WebglAddon`;
- scrollback and screen buffers;
- one xterm input subscription;
- one `ResizeObserver`;
- two window event listeners;
- two preload IPC subscriptions; and
- an optional startup animation-frame callback.

### Main

- one node-pty shell process;
- node-pty data and exit subscriptions;
- one bounded output batcher;
- one inspection capture ring;
- an incomplete OSC parser tail;
- workspace/OSC routing state; and
- an owning `WebContents` relationship.

### Preload / IPC

- renderer-to-main input, resize, acknowledgement, and disposal messages; and
- main-to-renderer data and exit listeners.

This inventory immediately reveals why React cleanup is necessary but
insufficient. React can unmount normally, but it cannot run an effect cleanup
after the renderer crashes. Main owns the operating-system process, so main must
have an independent owner-loss path.

## 2. Identity is not authority

A surface ID answers “which terminal?” It does not answer “who may control it?”

Suppose renderer A owns terminal `term-7`. A reload creates renderer B and a new
terminal with the same restored ID. A delayed disposal message from A arrives:

```text
A owns old term-7
  → B creates replacement term-7
  → delayed A dispose(term-7)
  → ID-only registry kills B's terminal
```

The bug is a confused-deputy problem. Main has the authority to kill a PTY, while
the stale sender supplies only a shared lookup key.

The correct lookup is a pair:

```text
(stable terminal ID, exact renderer owner)
```

Electron already provides the unforgeable owner object at the IPC boundary:
`event.sender`, a `WebContents`. Main compares object identity rather than
accepting a renderer-supplied owner ID.

The same check belongs on every control message:

- creation or replacement;
- input;
- resize;
- output acknowledgement; and
- explicit disposal.

An acknowledgement is control, not harmless telemetry. Releasing another
terminal's in-flight byte window can defeat flow control and reorder future
delivery.

## 3. Use a two-index ownership registry

A useful registry supports both terminal lookup and bulk owner loss:

```text
terminal ID ──► { owner, terminal }
owner ────────► { terminal IDs, unsubscribe }
```

The first index makes ordinary IPC constant-time. The second makes renderer crash
cleanup proportional to that renderer's terminals rather than every terminal in
the application.

Only one `destroyed`/`render-process-gone` subscription is needed per
`WebContents`. Adding one listener per terminal creates unnecessary EventEmitter
pressure and makes listener cleanup another leak vector.

Removal accepts an optional expected terminal object:

```ts
remove(id, expectedTerminal)
```

If the ID now points to a replacement, removal fails closed. This is a small
compare-and-delete operation, analogous to compare-and-swap:

```text
delete only if current value === value cleanup originally observed
```

That condition protects natural-exit callbacks, explicit disposal, owner loss,
and replacement races.

## 4. Remove registry state before callbacks

Owner loss can release many PTYs. The safe order is:

1. delete the owner group;
2. delete every owned terminal record;
3. remove the owner listener;
4. invoke each terminal's resource cleanup.

Why not call cleanup first? Cleanup can reenter registry methods, throw, or
trigger a node-pty exit callback. If the records still look live, reentrancy can
double-dispose or touch a replacement.

Deleting state first makes repeated cleanup a no-op. Callback exceptions are
contained per terminal so one broken PTY does not retain its siblings.

The general rule is:

> Commit the ownership-state transition before invoking fallible side effects.

This pattern applies to sockets, subscriptions, worker pools, database leases,
and any resource group released after its client disappears.

## 5. Define every terminal end state

Cleanup is easier to reason about when each route has a name:

| Reason       | Trigger                      | Renderer still usable? | Drain pending output? |
| ------------ | ---------------------------- | ---------------------- | --------------------- |
| `disposed`   | normal React unmount         | usually                | yes                   |
| `exited`     | shell exits naturally        | usually                | yes                   |
| `replaced`   | duplicate stable ID creation | possibly               | yes                   |
| `owner-lost` | renderer destroyed/crashed   | no                     | no                    |
| `shutdown`   | application quit             | no guarantee           | no                    |

Draining output only helps when a live consumer can receive it. On renderer loss
or shutdown, attempting a final send increases failure surface without improving
user-visible correctness.

Every route must release:

```text
node-pty subscriptions
  → output scheduler/queues/backpressure
  → PTY process
  → ownership records/listeners
  → inspection capture
```

Natural exit is slightly different because the operating-system process is
already gone. It still disposes subscriptions and flow-control state, notifies a
live renderer, and removes the exact registry record.

## 6. Bound memory by design

“We clean it up later” does not bound memory while a terminal is live. Every
buffer needs either a numerical maximum or a proof that upstream backpressure
prevents accumulation.

cmux-linux uses:

| Resource                |                Bound |
| ----------------------- | -------------------: |
| xterm scrollback        |          1,000 lines |
| inspection capture      | 256 KiB per terminal |
| incomplete OSC tail     |                8 KiB |
| target output batch     |               32 KiB |
| normal in-flight output |              128 KiB |
| PTY pause watermark     |              256 KiB |
| PTY resume watermark    |               64 KiB |

The xterm value is explicit even though 1,000 was previously the dependency
default. Relying on a library default hides a product decision and allows an
upgrade to change retention silently.

Reducing scrollback just to improve a benchmark would trade away useful terminal
history. A limit change needs product reasoning, ideally a setting with a safe
upper bound, not a single-process memory headline.

Some resources are not easily expressed as bytes. A listener is bounded by
cardinality and ownership:

```text
one terminal → one resize observer
one renderer → one owner-loss listener pair
one subscription → one stored disposer
```

That is still a retention contract.

## 7. Keep diagnostics aggregate and opt-in

Lifecycle diagnostics need enough information to answer “what remained?” without
becoming a terminal recorder.

A safe snapshot can contain:

```ts
interface TerminalMemorySnapshot {
  reason: TerminalMemorySnapshotReason
  terminalCount: number
  ownerCount: number
  inspectionTerminalCount: number
  inspectionRetainedBytes: number
  inspectionDroppedBytes: number
  pendingOutputBytes: number
  inFlightOutputBytes: number
  pausedTerminalCount: number
}
```

It does not need:

- terminal IDs;
- prompts or output;
- keystrokes;
- commands or argv;
- cwd or repository paths; or
- environment values.

cmux-linux reads `CMUX_MEMORY_DIAGNOSTICS` once at startup and enables logging
only for the exact value `1`. A misspelled or ambiguous value cannot accidentally
turn diagnostics on. Logging is confined to creation and cleanup boundaries,
not the output hot path, and exceptions are swallowed so observability cannot
break the terminal.

Inspection totals iterate existing buffers and add their lengths. They do not
concatenate, decode, or copy the content. Output diagnostics read counters the
batcher already owns.

## 8. PSS explains scaling better than summed RSS

Electron is a process tree. Main, renderer, GPU, utility, and zygote processes
map shared Chromium code and data. Summing resident set size charges the same
shared pages repeatedly.

Proportional set size divides each shared page among the processes mapping it:

```text
process PSS = private resident pages
            + each shared resident page / number of mappings
```

Summing PSS across the owned process tree is therefore a better application
total. RSS remains a useful counter-metric but not the primary comparison.

Terminal scaling should measure:

```text
fixed cost = settled PSS with one terminal
incremental slope = (PSS at 8 - PSS at 1) / 7
```

Intermediate 2- and 4-terminal points reveal nonlinear behavior. Process
composition explains whether the slope comes from one shell per terminal,
renderer allocations, GPU resources, or main-process captures.

cmux-linux observed six fixed Electron processes and one Bash process per live
terminal. That made the 7/8/10/14 total process counts at 1/2/4/8 terminals
directly explainable.

## 9. Closing live resources need not return cold PSS

A leak means unreachable resources remain live. PSS answers a different question:
how many resident pages are currently charged to the process tree.

V8, libc, Chromium, graphics drivers, and GPU allocators often retain freed pages
in arenas for reuse. After a high-water workload:

```text
live objects return to baseline
process count returns to baseline
PTY count returns to baseline
PSS returns only to a warmer plateau
```

That pattern does not prove a leak. It also does not prove the absence of one.
Corroborating evidence matters:

- exact ownership/resource counters;
- stable process counts;
- stable shell PSS;
- a long repeated lifecycle run;
- comparison with the pre-feature build; and
- heap or allocator profiling when stronger attribution is needed.

In the matched 30-cycle run, baseline and candidate warmed at the same stages.
The candidate returned all managed counts exactly and ended below baseline PSS.
That rejects a candidate-only retained-PTY explanation. The remaining high-water
pages were concentrated in Electron helpers, not extra shells.

## 10. Benchmark process ownership is a security boundary

A benchmark that launches and kills process trees is itself privileged
automation. A name match such as `pkill cmux-linux` is unacceptable because it
can terminate the user's real app.

The lifecycle harness uses:

1. the exact PID returned by `spawn()` as root proof;
2. `/proc` parent ancestry for descendants;
3. a random run marker where children retain it;
4. process start ticks captured before signaling; and
5. identity revalidation before escalation from `SIGTERM` to `SIGKILL`.

PID revalidation matters because numeric PIDs are reusable. If a process exits
between the first and second signal, the same number could theoretically belong
to an unrelated process. Matching its original start tick closes that race.

Each run also gets private XDG directories, socket, cwd, and log. Output paths
must remain under `/tmp` or the benchmark results directory and may not overwrite
existing files.

## 11. Failure handling

Lifecycle code is designed for races rather than assuming a happy ordering:

- renderer destruction and renderer-process failure can both fire;
- PTY exit can race explicit disposal;
- `WebContents` can close between `isDestroyed()` and `send()`;
- node-pty can exit between lookup and `kill()`;
- a delayed callback can observe a reused surface ID;
- diagnostic logging can throw;
- `/proc` entries can disappear during measurement; and
- the host can be too pressured for meaningful results.

Idempotent registry removal, exact-value checks, contained callbacks, bounded
waits, and pressure gates turn those races into safe no-ops or explicit benchmark
failures.

## 12. Testing strategy

The ownership registry is tested as a pure state machine. That gives deterministic
coverage of cross-owner access, replacement, listener cardinality, repeated
cleanup, failure containment, and clear behavior without mocking Electron.

Focused module tests cover:

- inspection retained/dropped-byte totals and removal;
- output in-flight accounting, acknowledgement, and disposal;
- exact diagnostic opt-in and scrollback constants; and
- diagnostic parsing, process ownership, role sanitization, summaries, and
  recovery classification.

Production Electron runs then cover what unit tests cannot:

- real React workspace creation/unmount;
- xterm and WebGL/fallback construction;
- real node-pty shells;
- Unix-socket control;
- `/proc` PSS and process topology;
- repeated close behavior; and
- marker-owned cleanup.

Unit tests prove invariants. Live tests prove integration. Measurements explain
cost. None substitutes for the others.

## 13. Alternatives and tradeoffs

### Trust React cleanup

This is simple and works for normal unmount, but a crashed renderer never runs
its effect cleanup. Main-owned PTYs would survive their UI.

### Key everything only by terminal ID

This minimizes registry structure but turns a stable routing key into
authorization and permits stale-renderer control.

### Install one owner-loss listener per terminal

It makes local cleanup obvious, but listener count grows with terminal count and
bulk renderer cleanup becomes duplicated event work.

### Use weak references

Weak references can help cache policy but are not a lifecycle protocol. Garbage
collection is nondeterministic and does not kill an operating-system PTY.

### Force garbage collection during benchmarks

Electron/V8 flags could expose a diagnostic experiment, but forcing GC changes
the product workload and does not necessarily return allocator arenas to the OS.
It must not become the acceptance trick.

### Reduce buffers aggressively

This can lower PSS while harming scrollback, inspection, and throughput. Explicit
bounds plus measurements preserve useful behavior.

### Expose diagnostics over renderer IPC

A live UI could display counts, but that expands public bridge surface and risks
turning internal process objects into renderer data. Lifecycle-only main logs are
smaller and safer for the present goal.

## 14. Extension points

The current design leaves several measured next steps:

- add renderer heap snapshots or allocation sampling in an isolated diagnostic
  build;
- distinguish renderer/GPU/utility/zygote memory when safe process-role metadata
  is available;
- make scrollback user-configurable with validation and a maximum;
- expose a read-only aggregate diagnostic socket method if operational demand
  justifies the API;
- test real renderer crash recovery in a multi-window future;
- measure alternate-screen and long-scrollback workloads separately; and
- combine lifecycle scaling with hardware/WebGL/software rendering comparisons.

The next performance phase focuses on rendering and resize scheduling. It should
reuse the same ownership discipline: coalesce work without weakening cleanup,
record WebGL versus fallback honestly, and treat every added observer or frame
callback as an owned resource.

## 15. Checkpoint

1. Why is `(terminal ID, WebContents)` safer than terminal ID alone?
2. What race does expected-value removal prevent?
3. Why does main need renderer-loss cleanup even when React disposes xterm?
4. Which terminal buffers are numerically bounded?
5. Why is PSS preferable to summed RSS for Electron?
6. What evidence separates allocator high-water pages from retained PTYs?
7. How do process start ticks protect benchmark cleanup?
8. Which evidence would you add before claiming that warm helper memory contains
   no unreachable renderer objects?
