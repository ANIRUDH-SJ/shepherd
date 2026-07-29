# M19 — Bounded Terminal Output Batching

## 1. The goal

Every `node-pty` data event used to cross Electron IPC immediately. A noisy
command could therefore make the main process repeat inspection, OSC parsing,
serialization, IPC dispatch, and `term.write()` for many tiny chunks. The work
was correct, but the number of handoffs limited bulk-output throughput.

This milestone adds a short, bounded batching stage without changing what the
terminal displays. It also makes renderer capacity explicit: main tracks output
until xterm confirms that it consumed each write. The first prompt and output
associated with recent keyboard input still bypass the batching delay.

## 2. Files changed

```text
src/main/
├── pty.ts
├── terminalOutputBatcher.ts
└── terminalOutputBatcher.test.ts
src/preload/index.ts
src/renderer/src/components/TerminalHost.tsx
src/shared/
├── ipc.ts
└── ipc.test.ts
```

`package.json` adds both new tests to the normal `npm test` chain. The matched
production comparison is recorded in
`benchmarks/results/2026-07-29-output-batching.md`.

## 3. The batcher owns flow-control state

`TerminalOutputBatcher` is independent of Electron and node-pty. Its constructor
receives small callbacks for sending, pausing, resuming, time, and scheduling.
That separation makes the state machine deterministic in a headless test.

The production limits are:

| Limit                   |   Value | Purpose                                           |
| ----------------------- | ------: | ------------------------------------------------- |
| Target batch            |  32 KiB | Amortize parser and IPC overhead                  |
| Maximum delay           |    4 ms | Bound latency for small output                    |
| Normal in-flight window | 128 KiB | Avoid outrunning xterm                            |
| PTY pause high-water    | 256 KiB | Bound retained output                             |
| PTY resume low-water    |  64 KiB | Add hysteresis and avoid pause/resume churn       |
| Interactive window      |   50 ms | Forward likely input echo and prompts immediately |

`push(data)` appends the string to `pendingChunks` and tracks its UTF-8 byte
length. It then chooses one of three paths:

1. the terminal's first chunk or output inside the interactive window flushes
   immediately;
2. at least 32 KiB flushes immediately when renderer capacity permits; or
3. smaller background output schedules one flush no more than 4 ms later.

Chunks stay as an array until flush time. A single chunk is reused directly;
multiple chunks are joined once. The batcher never decodes or slices terminal
text, so split JavaScript surrogate pairs, ANSI sequences, and OSC sequences
retain their original order.

## 4. Acknowledgements close the feedback loop

Every emitted batch receives a monotonically increasing sequence. The batcher
stores `sequence → byte count` in `inFlight` and will normally keep no more than
128 KiB ahead of the renderer.

The complete path is:

```text
node-pty data
  → TerminalOutputBatcher.push
  → terminal:data { id, data, sequence }
  → preload callback
  → xterm.write(data, callback)
  → terminal:data-ack { id, sequence }
  → TerminalOutputBatcher.acknowledge
```

The callback means xterm consumed the write into its parser/buffer. It does not
claim that a monitor presented the final pixels. On acknowledgement, main
releases the recorded bytes and flushes any batch that had been waiting for
capacity.

`TermData.sequence` remains optional so the bridge can safely receive an older
unsequenced message during reload or mixed-version development. The preload
only acknowledges safe integer sequences and closes over a boolean so one xterm
callback can send at most one acknowledgement.

## 5. Backpressure reaches the PTY

Pending and unacknowledged bytes are counted together. At 256 KiB,
`TerminalOutputBatcher` calls `proc.pause()`. It waits until the total falls to
64 KiB before calling `proc.resume()`.

The separate high and low values are important. If both were 256 KiB, one
acknowledgement could repeatedly toggle the stream around the boundary. The
lower resume point lets the renderer recover meaningful capacity first.

Exceptions from `send`, `pause`, or `resume` are contained. If the renderer has
already closed, `pty.ts` returns `false` from the send callback so the batcher
releases that capacity immediately instead of waiting for an acknowledgement
that cannot arrive.

## 6. `pty.ts` integrates batching once per terminal

Each `TerminalRec` now owns:

- the `WebContents` that created it;
- one `TerminalOutputBatcher`; and
- disposable node-pty data and exit subscriptions.

The batcher's send callback performs the old hot-path responsibilities once per
emitted batch: append inspection output, send `TERM_DATA`, and pass the exact
same text through `sniffOsc`.

The acknowledgement handler validates the runtime payload with `isTermDataAck`.
It also requires `event.sender` to equal the terminal's owning `WebContents`, so
one window cannot release flow-control state belonging to another window.

Before a keystroke reaches `proc.write`, `markInteractive()` drains pending text
and starts the 50 ms immediate-output window. Natural exit drains the final
undersized batch before sending `TERM_EXIT`. Explicit disposal also drains,
while application shutdown discards pending UI work because the renderer is
leaving. All paths cancel timers, dispose subscriptions, clear acknowledgements,
and balance a paused PTY.

## 7. Renderer integration

The preload still exposes only the narrow `window.api.terminal` surface. Its
`onData` callback now supplies `(data, acknowledge)`.

`TerminalHost` passes that callback directly to xterm:

```ts
term.write(data, acknowledge)
```

The startup-diagnostics special case acknowledges first and then schedules its
existing animation-frame milestone. Terminal exit text uses another
`term.write`, so xterm's own write queue keeps the final output before the exit
banner.

## 8. Verification and measured effect

Unit coverage exercises time and byte flushes, ordering, split Unicode, the
interactive path, in-flight gating, unknown acknowledgements, high/low-water
backpressure, exit draining, disposal, and a closed renderer.

An isolated production Electron smoke test rendered 50,000 ANSI/Unicode lines,
delivered an OSC notification, accepted interactive input afterward, and showed
a no-newline Unicode tail before the exit message.

The matched production benchmark used five warm-ups and 20 measured samples per
build. Median parser round trip fell from 390.92 ms to 321.69 ms, and median
throughput rose from 20.47 to 24.87 MiB/s. The candidate won all 20 paired
rounds. Startup, idle CPU, PSS, and RSS medians changed by no more than 0.34%.
The report records the end-of-run pressure caveat and the benchmark's narrower
parser-completion meaning.

## 9. Checkpoint

You should now be able to explain:

1. why a 4 ms timer and a 32 KiB threshold serve different workloads;
2. why xterm's write callback is a better flow-control boundary than IPC send;
3. how hysteresis keeps PTY backpressure stable;
4. why terminal text is joined but never split by the batcher; and
5. why parser throughput still cannot prove input-to-photon or rendered-frame
   latency.
