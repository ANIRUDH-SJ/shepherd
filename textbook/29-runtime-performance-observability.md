# 29 — Runtime performance observability

Optimization should begin with a causal question, not a fast-looking patch.
“Startup took 700 ms” is an outcome. It does not tell us whether Electron
initialization, session loading, React, xterm, WebGL, node-pty, the shell, or
background services owned the delay.

Runtime instrumentation turns that single duration into a sequence of named
boundaries:

```text
process
  -> Electron ready
  -> backend services registered
  -> BrowserWindow created
  -> renderer bootstrapped
  -> React mounted
  -> xterm opened and fitted
  -> WebGL loaded or fell back
  -> PTY spawned
  -> first shell output
  -> first xterm write + animation frame
  -> visible startup ready
```

This chapter explains how to design that sequence without turning diagnostics
into a permanent performance cost or a privacy risk.

## 1. External and internal benchmarks answer different questions

The terminal benchmark harness measures cmux-linux from outside. That is the
right boundary for comparing applications because every subject receives the
same observer. Internal instrumentation is intentionally not comparable with
Kitty, Ghostty, or GNOME Terminal because their phase names and architectures
differ.

The two forms complement each other:

| Observer         | Best question                                                           |
| ---------------- | ----------------------------------------------------------------------- |
| External harness | Did total behavior improve relative to the baseline and other subjects? |
| Internal trace   | Which cmux-linux stage changed, and what should we profile next?        |

An internal event must never replace the external result. Product code can report
itself “ready” too early. The external worker remains the independent check.

## 2. Define semantic boundaries before measuring

A timestamp is useful only when its boundary is stable. “Renderer ready” could
mean JavaScript downloaded, React invoked, DOM committed, the first frame
requested, or the first frame displayed. Mixing those definitions across runs
creates false improvements.

cmux-linux uses names tied to concrete calls or lifecycle events:

- `electron-ready` is the resolution of `app.whenReady()`;
- `window-created` follows the `BrowserWindow` constructor;
- `renderer-bootstrap` is the first renderer entry-module report;
- `terminal-opened` follows `term.open(container)`;
- `pty-spawned` follows the return from `pty.spawn()`; and
- `terminal-first-output-written` follows xterm's write callback and an animation
  frame.

These names still have limitations. An animation frame is not proof that photons
reached a monitor. The honest name describes the software boundary instead of
claiming hardware presentation.

## 3. Keep one clock owner

Main and renderer are different operating-system processes. Subtracting raw
`performance.now()` values from them would be incorrect because each clock has a
different zero point.

This design makes Electron main the clock owner. Renderer milestones travel over
IPC as fixed names; main timestamps them when received using its monotonic
`performance.now()` clock. The duration therefore includes a small IPC delivery
cost, but every event shares one origin and system-clock adjustments cannot move
time backward.

For deeper renderer profiling, a future clock-synchronization handshake could
estimate process offset and transport delay. That extra complexity is not needed
for coarse startup phases. Stable, explainable receipt-time boundaries are more
valuable than fake cross-process precision.

## 4. Treat the trace as a small state machine

Startup does not occur in one guaranteed linear order. A PTY can emit output
before the window becomes visible. React effects and animation frames can
interleave with IPC. WebGL may succeed on one host and fall back on another.

The recorder therefore stores a set of first observations rather than expecting
a rigid sequence. Completion requires:

```text
main lifecycle
+ backend registered
+ window created and visible
+ renderer bootstrapped and mounted
+ xterm opened and fitted
+ (WebGL OR fallback)
+ PTY request, spawn, and first output
+ first xterm output write
= startup-ready
```

Each name is recorded once. This makes the state machine idempotent when multiple
terminal components mount or an event is accidentally repeated. Sorting the
final snapshot by elapsed time preserves the observed chronology.

If shutdown happens first, a partial trace is emitted with `complete:false`.
That distinction is operationally important: missing readiness is evidence, not
a slow sample that should be silently discarded.

## 5. Select the terminal that represents startup

Restored layouts may contain multiple panes and hidden tabs. “First PTY event”
could otherwise describe a hidden terminal that the user cannot see.

The renderer marks only the initially focused terminal as the startup candidate.
That boolean travels with `terminal:create`, and main uses it solely to decide
which PTY contributes startup milestones. The recorder still deduplicates names
as a second line of defense.

This is a measurement projection, not application state. It does not change
which terminals spawn or which tab is active. Later scalability work should use
a different schema that records every terminal with bounded, non-sensitive
numeric identity rather than overloading this startup trace.

## 6. Make disabled diagnostics genuinely cheap

Instrumentation can invalidate its own measurements if it adds work to hot
paths. The safest default is an explicit launch-time opt-in:

```bash
CMUX_PERF_DIAGNOSTICS=1 npm run start
```

Without the exact value `1`:

- the recorder returns before allocating event records;
- preload sends no performance IPC;
- renderer schedules no diagnostic animation frame;
- main supplies no PTY marker callback; and
- PTY/xterm data use their direct, non-instrumented callbacks.

Choosing the callback once at terminal creation is better than checking a flag
for every output chunk. This pattern generalizes:

```ts
const handleData = diagnosticsEnabled ? instrumentedHandler : normalHandler
stream.onData(handleData)
```

The diagnostic run may pay for a one-time callback, IPC messages, JSON encoding,
and console output. The normal application should not.

## 7. Bound the protocol at the trust boundary

Compile-time unions help developers but do not validate IPC. The renderer is a
less-trusted process, so main accepts only a fixed subset of renderer-owned
milestone names. It rejects unknown values and main-owned milestones such as
`electron-ready`. The message carries no detail object and no caller-supplied
timestamp.

That design prevents accidental collection of:

- terminal input or output;
- shell commands and arguments;
- prompts or agent conversations;
- cwd, repository names, or file paths; and
- environment values.

The emitted summary contains schema version, trace kind, completion, names, and
elapsed milliseconds. It stays on stdout/stderr and performs no file or network
I/O. An operator who wants persistence can redirect the explicitly enabled
process output into a private benchmark directory.

The `startupPerformanceCandidate` flag is not authority. It cannot spawn an
additional process, change a path, or expose content. Main still owns the timer
and accepts each milestone only once.

## 8. Separate rendering mode from rendering speed

WebGL availability changes both behavior and interpretation. A trace must record
whether xterm loaded its WebGL addon or used its normal fallback. Otherwise two
runs could appear to compare startup while actually using different renderers.

The renderer reports exactly one of:

```text
terminal-renderer-webgl
terminal-renderer-fallback
```

Fallback is not failure. Systems without a usable GPU must retain a correct
terminal. Performance analysis should group or label the two paths and never
quietly average them together.

Context loss after startup is a separate lifecycle problem. The current xterm
handler disposes the lost WebGL addon. A later render-resize PR should measure
recovery and may add bounded post-start diagnostics under a different trace
kind.

## 9. Read the output

The diagnostic output is one newline-delimited JSON object with a stable prefix:

```text
[cmux:perf] {"schemaVersion":1,"kind":"startup","complete":true,"events":[...]}
```

For two adjacent events:

```text
backend-services-started  338.6 ms
window-created            386.6 ms
```

the interval is approximately 48 ms. That does not prove the window constructor
used all 48 ms; other main-loop work may be interleaved. The trace tells us which
span deserves profiling. CPU sampling or a Chromium trace can then explain work
inside that span.

Never optimize from one diagnostic run. Use the external harness conditions:
stable power and CPU policy, low pressure, warmups, repeated samples, raw values,
and counter-metrics. Compare the same milestone distribution before and after a
single behavioral change.

## 10. Alternatives and why they were not chosen

### Chromium performance marks only

`performance.mark()` and DevTools are excellent inside one renderer, but they do
not naturally cover Electron main, node-pty, or shell output. They also encourage
manual analysis rather than one bounded startup record.

### Electron or Chrome tracing

Full tracing can expose tasks, frames, IPC, and GPU work in great detail. It
produces large, version-sensitive files and adds more overhead. Use it after this
coarse trace identifies a suspicious span.

### Write a diagnostic file from the app

Direct persistence is convenient but adds startup file I/O, path validation,
permissions, overwrite semantics, and cleanup. Console output keeps the product
boundary smaller; the benchmark launcher can own storage.

### Detect a shell prompt

Prompt text and escape sequences depend on the user's shell configuration and
may contain sensitive data. A shell can also be usable without emitting a
recognizable prompt. First PTY output and the external benchmark worker provide
safer, explicitly narrower boundaries.

### Always-on telemetry

Remote telemetry could reveal distributions across real machines, but it creates
consent, privacy, retention, networking, and product-policy obligations. Local,
explicit diagnostics are sufficient for the current optimization program.

## 11. Testing and failure handling

Pure tests should cover:

- the exact opt-in rule;
- uniqueness and validation of milestone names;
- disabled no-op behavior;
- first-event deduplication;
- monotonic-value rounding;
- WebGL-or-fallback completion;
- single complete emission; and
- one partial shutdown emission.

Typechecking connects the shared contract to preload and renderer. A live
production smoke test is still required because unit tests cannot prove
`BrowserWindow`, React effects, xterm callbacks, node-pty, animation frames, and
real Electron IPC form a complete trace.

An unavailable WebGL context should produce fallback and still complete. A shell
that never outputs should leave the trace partial rather than invent readiness.
Unknown IPC names should disappear at validation. Diagnostic output failure must
never crash or block the terminal.

## 12. Using instrumentation for the next optimization

The next PR can defer agent discovery, Git metadata, and other noncritical work
until the first terminal is usable. Runtime traces should answer:

1. Did `terminal-first-output-written` move earlier?
2. Did `window-visible` or the renderer stages regress?
3. When did deferred services become ready?
4. Did the external process-to-worker-ready distribution improve?
5. Did discovery and metadata freshness remain within their product bounds?

A winning optimization improves the targeted distribution beyond normal
variance without making input latency, correctness, CPU, memory, or feature
freshness worse.

## Checkpoint

1. Why can renderer and main not safely subtract their raw `performance.now()`
   values?
2. What does `terminal-first-output-written` prove, and what does it not prove?
3. Why is renderer mode a completion alternative rather than one required name?
4. How does callback selection protect the disabled terminal output path?
5. Why should a partial trace be emitted instead of discarded?
6. When should full Chrome tracing be introduced?
