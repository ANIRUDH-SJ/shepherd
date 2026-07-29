# M17 foundation — Runtime performance instrumentation

## The goal

The benchmark harness can say that one cmux-linux launch took a certain amount
of time, but it cannot explain where that time went. This first M17 increment
adds an opt-in startup trace across Electron main, preload, React, xterm.js,
WebGL fallback, node-pty, and the first terminal frame.

The feature does not optimize startup by itself. It creates the causal evidence
needed for the next PR, which will move noncritical services out of the
first-terminal critical path.

## What changed

| File                                           | Responsibility                                               |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `src/shared/runtimePerformance.ts`             | Fixed milestone vocabulary, schema, flag, and validation     |
| `src/shared/runtimePerformance.test.ts`        | Opt-in and untrusted-name regressions                        |
| `src/main/runtimePerformance.ts`               | Deduplicated monotonic recorder and JSON summary             |
| `src/main/runtimePerformance.test.ts`          | Completion, rounding, partial-flush, and disabled-mode tests |
| `src/main/index.ts`                            | Main lifecycle marks and validated renderer ingestion        |
| `src/main/pty.ts`                              | First measured PTY spawn and output marks                    |
| `src/shared/ipc.ts`                            | Typed diagnostic channel and restricted preload surface      |
| `src/preload/index.ts`                         | Disabled-by-default performance bridge                       |
| `src/renderer/src/main.tsx`                    | Renderer bootstrap and first committed-frame marks           |
| `src/renderer/src/components/TerminalHost.tsx` | xterm, renderer mode, and first written-output marks         |

## 1. One bounded vocabulary

`RUNTIME_PERFORMANCE_MARK_NAMES` is the only set of accepted names. It contains
fixed labels such as `electron-ready`, `terminal-renderer-webgl`,
`pty-first-output`, and `window-visible`. `RuntimePerformanceMarkName` is derived
from that tuple, so main, preload, and renderer compile against the same contract.

The runtime guard `isRendererRuntimePerformanceMarkName()` matters because
TypeScript types disappear at IPC. A compromised or buggy renderer can still
send arbitrary JavaScript values. Main records only a renderer-owned name and
rejects unknown values plus main-owned names such as `electron-ready`. There is
no free-form detail field that could accidentally collect a prompt, command,
terminal chunk, path, argument, or environment value.

`runtimePerformanceDiagnosticsEnabled()` accepts only:

```text
CMUX_PERF_DIAGNOSTICS=1
```

Values such as `true` are rejected. With no exact opt-in, the feature emits
nothing.

## 2. The main recorder

`RuntimePerformanceRecorder` owns an insertion-ordered map keyed by milestone.
`mark()` returns immediately when diagnostics are disabled, the name was already
seen, or the supplied time is not finite. This gives startup tracing three useful
properties:

1. React remounts or multiple terminals cannot duplicate a stage.
2. Only the first startup path is measured.
3. A bad clock sample cannot corrupt the JSON.

Main injects `performance.now()` from Node's monotonic performance clock. The
first event is explicitly `main-process-start` at zero; `main-module-loaded`
therefore includes Electron/Node initialization and static module evaluation
before the entry module reaches the recorder.

`snapshot()` sorts events by elapsed time and rounds to microsecond-shaped
millisecond precision. The recorder declares completion only after it sees the
required main, window, renderer, terminal, PTY, and visible-output stages plus
either WebGL success or software fallback. It then adds `startup-ready` and emits
one line:

```text
[cmux:perf] {"schemaVersion":1,"kind":"startup","complete":true,"events":[...]}
```

If the app quits before completion, `before-quit` calls `flush()` and emits one
`complete:false` summary. A missing phase is therefore inspectable rather than
silently disappearing.

## 3. Main-process milestones

`src/main/index.ts` creates the recorder once at module evaluation and marks:

- Electron's `whenReady()` resolution;
- completion of socket, discovery, metadata, PTY, and session handler startup;
- `BrowserWindow` construction; and
- the window becoming visible after `ready-to-show`.

The existing behavior is unchanged. These calls only observe boundaries; they
do not delay window creation or reorder services.

The same file receives `performance:mark` IPC. It validates the unknown payload
through the shared allowlist before calling the recorder.

## 4. PTY milestones

`registerPtyIpc()` accepts an optional marker callback. Main supplies it only
when diagnostics are enabled. The renderer labels its initially focused terminal
as `startupPerformanceCandidate`, preventing a hidden restored tab from winning
the process-wide “first terminal” race.

For that candidate, `src/main/pty.ts` records:

- `pty-spawn-requested` immediately before terminal creation;
- `pty-spawned` after `node-pty` returns the live process; and
- `pty-first-output` on the first shell data event.

The output listener is selected when the PTY is created. Disabled diagnostics
use the normal `proc.onData(forwardData)` callback with no per-chunk diagnostic
branch. Only an opted-in candidate receives the one-time wrapper.

## 5. Renderer and terminal milestones

`src/renderer/src/main.tsx` reports `renderer-bootstrap` when its module begins
and `renderer-mounted` on the next animation frame after asking React to render.
The preload exposes only `performance.enabled` and `performance.mark(name)`;
when disabled, it sends no diagnostic IPC.

The initially focused `TerminalHost` records:

- xterm opening its DOM;
- the first `FitAddon.fit()`;
- successful WebGL loading or the normal fallback path; and
- completion of the first `term.write()` followed by an animation frame.

The last event is named `terminal-first-output-written`, not “pixels presented.”
The xterm callback proves its write queue consumed the first chunk, and the frame
wait gives the browser an opportunity to paint. It is still a software readiness
boundary, not hardware input-to-photon proof.

As with PTY output, `TerminalHost` chooses the callback once. Disabled diagnostics
keep the direct `term.write(data)` path. The per-chunk first-write branch exists
only during an opted-in startup trace.

## 6. Tests and live proof

The shared contract test proves exact opt-in behavior, unique names, and rejection
of unknown/non-string values. The recorder test proves disabled no-op behavior,
deduplication, deterministic rounding, readiness completion, single emission,
and partial shutdown output.

An isolated production-preview smoke test used a private socket, private session
path, and Xvfb display. The app opened one visible window, its socket answered,
and the trace completed with all expected stages. Xvfb could not provide WebGL,
so the trace correctly recorded `terminal-renderer-fallback`. The single
`startup-ready` observation was 1398.773 ms and is smoke evidence only, not a
performance baseline.

## What remains

This instrumentation identifies phase boundaries; it does not yet capture a
controlled distribution or change startup ordering. Next work should collect a
valid baseline, then use these events to evaluate deferred background-service
startup without weakening discovery, metadata freshness, or session restore.
