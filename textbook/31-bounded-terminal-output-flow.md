# 31 — Bounded Terminal Output Flow

A terminal output path connects components with very different timing:

```text
program → kernel PTY → node-pty → Electron main → IPC → renderer → xterm → screen
```

A command can produce megabytes as fast as the kernel accepts writes. The
renderer, however, must parse control sequences, update terminal buffers, and
schedule drawing alongside the rest of the UI. If every small producer event
becomes a separate cross-process message, coordination overhead can dominate the
actual text processing.

This chapter develops the flow-control design used by cmux-linux. The ideas also
apply to logs, network streams, telemetry ingestion, and any producer/consumer
pipeline where throughput must improve without unbounded memory or unacceptable
interactive latency.

## 1. Separate throughput, latency, and capacity

These three properties are related but not interchangeable:

- **Throughput** is how many bytes complete per second.
- **Latency** is how long a particular byte waits before becoming usable.
- **Capacity** is how much unfinished work the pipeline may retain.

Sending every PTY event immediately minimizes intentional waiting but creates
many IPC messages, callbacks, parser entries, and repeated side-channel scans.
Collecting an unlimited amount of text into one message minimizes message count
but delays prompts and can consume arbitrary memory.

The useful design is bounded batching: flush when either enough bytes accumulate
or a short deadline expires, then stop the producer when unfinished work crosses
a separate safety boundary.

## 2. A batch size and a deadline solve different problems

cmux-linux uses a 32 KiB target and a 4 ms deadline:

```text
background output reaches 32 KiB → flush now
background output stays below 32 KiB → flush by 4 ms
```

The byte threshold improves bulk throughput. The deadline protects sparse
output, where waiting for 32 KiB could otherwise delay a prompt forever.

This is not a traditional debounce. Debouncing moves the deadline every time a
new event arrives and can starve a continuous stream. The terminal schedules one
deadline for the oldest pending data and does not extend it. It is also not
simple throttling because a sufficiently large batch can flush before the timer.

The constants are latency budgets, not universal terminal truths. They must be
validated with the real application, production builds, realistic fixtures, and
counter-metrics. A faster parser benchmark does not justify a perceptibly slow
echo path.

## 3. Preserve interactive latency explicitly

Terminals combine background streams and conversations. A compiler can emit
thousands of lines, while a shell usually echoes a keystroke and prints a short
prompt.

cmux-linux identifies input as a useful local signal. Immediately before writing
a keystroke to the PTY, it:

1. flushes any pending output; and
2. opens a 50 ms interactive window.

Output arriving during that window bypasses the batching timer. This does not
pretend to classify terminal content or parse a prompt. It only says that output
closely following user input is latency-sensitive. The first PTY chunk also
flushes directly so initial prompt readiness does not acquire an artificial
delay.

This policy is deliberately conservative. It may sacrifice some batching during
active typing, but the product contract values responsiveness over a bulk
throughput headline.

## 4. An acknowledgement defines unfinished work

Electron successfully sending an IPC message only proves that Chromium accepted
the message. It does not prove xterm consumed the text. Flow control therefore
needs an acknowledgement from the actual consumer.

For every batch, main sends:

```ts
interface TermData {
  id: string
  data: string
  sequence?: number
}
```

The preload gives the renderer a one-shot acknowledgement callback. The renderer
passes it to:

```ts
term.write(data, acknowledge)
```

xterm calls the function after processing that queued write. Preload then sends:

```ts
interface TermDataAck {
  id: string
  sequence: number
}
```

Main stores the byte count for each sequence until that acknowledgement returns.
This produces an application-level sliding window:

```text
pending bytes + sent-but-unacknowledged bytes = unfinished bytes
```

The acknowledgement boundary is meaningful but narrow. It confirms parser/write
completion, not GPU submission, compositor completion, monitor presentation, or
input-to-photon latency. Rendered performance requires another measurement
endpoint.

## 5. Use two limits instead of one

cmux-linux normally stops emitting additional batches when sending them would
take the acknowledged window above 128 KiB. Pending bytes can continue to
accumulate briefly. At 256 KiB of total unfinished work, it pauses node-pty.

Why both limits?

- The 128 KiB window limits work already handed to the renderer.
- The 256 KiB high-water mark protects total retained work and pushes pressure
  back toward the kernel and child process.

When unfinished work falls to 64 KiB, node-pty resumes. Using a lower resume
point is **hysteresis**. A thermostat uses the same idea: turn cooling on at one
temperature and off at another so the system does not chatter at one boundary.

```text
0 KiB       64 KiB          128 KiB                 256 KiB
|-----------|---------------|-----------------------|
            resume PTY      normal send window      pause PTY
```

The hard bound is necessarily approximate. One producer event can cross a
threshold before `pause()` takes effect, and an interactive or lifecycle flush
may bypass the normal in-flight window. The important property is that a noisy
process cannot cause unlimited application-owned growth.

## 6. Keep one ordering authority

Terminal output is an ordered byte stream represented here as JavaScript
strings. ANSI control sequences, OSC notifications, and Unicode characters can
arrive across arbitrary node-pty event boundaries. Those event boundaries have
no display meaning.

The batcher therefore:

- appends chunks in arrival order;
- joins them only when emitting a batch;
- never sorts, decodes, truncates, or splits a chunk; and
- sends every batch through one per-terminal sequence.

`Buffer.byteLength()` is used only for accounting. If a surrogate pair is split
across two strings, measuring each half can conservatively overcount its encoded
size, but joining the original strings still reconstructs the character. A
conservative capacity estimate is safer than altering terminal data.

Inspection and OSC parsing consume the emitted batch in main before the same
text reaches xterm. The OSC parser already retains an incomplete suffix, so
coalescing events changes call frequency without changing its streaming
semantics.

## 7. Place responsibilities at process boundaries

Each layer has one job:

| Layer                   | Responsibility                                                   |
| ----------------------- | ---------------------------------------------------------------- |
| `TerminalOutputBatcher` | batching policy, sequences, capacity, pause/resume state         |
| `pty.ts`                | node-pty ownership, inspection, OSC, sender binding, lifecycle   |
| shared IPC              | channel names, payload types, runtime acknowledgement validation |
| preload                 | narrow bridge and one-shot acknowledgement closure               |
| `TerminalHost`          | xterm write and acknowledgement timing                           |

The renderer never receives `ipcRenderer`, and main never trusts TypeScript
alone. `isTermDataAck()` rejects missing, empty, oversized, fractional, zero, or
unsafe sequence values. Main also compares the IPC event sender with the
terminal's recorded `WebContents`. A valid-looking message from a different
window cannot free another window's capacity.

The data itself is still terminal output and must reach xterm unchanged. The
acknowledgement contains only a bounded terminal identifier and integer
sequence; it never echoes terminal content, commands, prompts, paths, or
environment values.

## 8. Treat lifecycle as part of ordering

A batching system is incomplete until exit and cancellation behavior is
defined.

On natural PTY exit, cmux-linux:

1. detaches the PTY listeners;
2. force-flushes the pending tail;
3. sends the exit event;
4. disposes the batcher; and
5. removes terminal inspection state.

Electron preserves message order from one sender, and xterm serializes its write
queue, so the tail enters xterm before the exit banner. This matters for commands
whose last output has no newline.

On explicit terminal replacement or closure, pending output is drained before
the process is killed. On application shutdown, pending UI output is discarded
because the renderer is leaving. Disposal cancels the timer, clears pending and
in-flight accounting, and resumes a paused PTY before ownership ends. Every
cleanup operation is safe to repeat or race with a process that already exited.

If the renderer closes between the destruction check and IPC send, the send
exception is contained. The batch is treated as not requiring acknowledgement,
so dead renderer capacity cannot permanently pause the PTY.

## 9. Test the state machine without time

Real timers make boundary tests slow and flaky. The batcher accepts injected
`now()` and `schedule()` functions, and tests use a manual task queue. They can
therefore assert exactly when a flush should occur.

Important cases include:

- first output and recent-input output are immediate;
- adjacent chunks preserve order;
- byte and time thresholds both flush;
- split Unicode code units rejoin correctly;
- an unknown or duplicate sequence releases nothing;
- pending output waits behind a full renderer window;
- high-water pause and low-water resume happen once;
- exit drains an undersized tail;
- disposal cancels scheduled work; and
- a closed renderer releases capacity without an acknowledgement.

Runtime contract tests separately exercise acknowledgement validation. A live
Electron smoke test covers the boundaries a pure unit test cannot: node-pty,
Chromium IPC, xterm parsing, OSC behavior, Unicode rendering, input after a
50,000-line burst, and exit ordering.

## 10. Measure the claim that the design makes

The feature claims fewer hot-path handoffs and better parser-oriented bulk
throughput. It does not claim a faster launch or lower Electron fixed memory.
The matched benchmark therefore keeps startup, PSS, RSS, and idle CPU as
counter-metrics while targeting parser completion.

Against the exact production build immediately before batching:

| Metric            | Before median | After median |  Change |
| ----------------- | ------------: | -----------: | ------: |
| Parser round trip |     390.92 ms |    321.69 ms | -17.71% |
| Parser throughput |   20.47 MiB/s |  24.87 MiB/s | +21.48% |
| Startup           |      559.0 ms |     560.4 ms |  +0.25% |
| PSS               |    140.21 MiB |   140.69 MiB |  +0.34% |
| Idle CPU          |         7.00% |        7.00% |   0.00% |

The candidate won all 20 paired rounds. End-of-run host pressure deteriorated,
so the report preserves that qualification and requires another cumulative run
on a freshly settled host. Honest performance work records adverse conditions
even when the target metric improves.

## 11. Alternatives and tradeoffs

### Keep sending every PTY event

This is simplest and has no intentional delay, but it repeats expensive
cross-process work for producer-defined chunk boundaries. The matched result
showed meaningful headroom in that overhead.

### Let xterm buffer everything

xterm already queues writes, but without main-process acknowledgements the
producer cannot know how far the consumer has fallen behind. Electron's IPC
queue becomes an invisible, poorly bounded buffer.

### Batch only in the renderer

Main would still pay per-event inspection, OSC, serialization, and IPC costs.
It would also enqueue all messages before renderer-side policy could apply
backpressure.

### Flush on every animation frame

Frames are a presentation schedule, not a reliable capacity signal. Background
windows, software rendering, and different refresh rates would change output
latency. A 4 ms monotonic deadline is independent of display cadence.

### Drop output under overload

Dropping makes charts look fast by breaking terminal correctness. Compiler
errors, control sequences, and prompts are user data. Backpressure is the
correct overload policy.

### Shared memory or transferable byte buffers

These can reduce copying further, but they introduce framing, encoding,
synchronization, and security complexity. The measured IPC batching gain should
land before adopting a lower-level transport.

## 12. Extension points

Future work can build on this boundary without changing terminal semantics:

- benchmark 4, 8, 16, and 32 KiB targets on multiple machines;
- record content-free queue-depth histograms under diagnostics;
- tune limits by renderer mode or measured acknowledgement rate;
- add a visibly settled sentinel for frame-oriented throughput;
- measure software input-to-present latency separately;
- move parsing or transport to a dedicated worker or `MessagePort` only if
  profiling justifies it; and
- test terminal-count scaling and memory recovery after repeated open/close
  cycles.

Adaptive policy must remain bounded and deterministic enough to test. It should
never inspect terminal prose to decide whether output is important.

## Checkpoint

1. Why is an IPC send not a useful consumer acknowledgement?
2. What different failure does each of the 4 ms, 128 KiB, 256 KiB, and 64 KiB
   limits prevent?
3. Why can byte accounting overestimate a split surrogate pair without corrupting
   its output?
4. Which lifecycle path should drain pending output, and which may discard it?
5. What additional endpoint is required before calling this rendered-frame
   throughput?
