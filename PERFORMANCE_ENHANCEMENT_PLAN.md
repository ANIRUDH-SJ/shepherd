# Terminal Performance Enhancement Plan

## Status and purpose

This document turns the first benchmark signals into a measured optimization
program for Shepherd. It is a plan, not a claim that a bottleneck has already
been proven. Each optimization must land in its own branch and PR with a
before/after comparison.

The 2026-07-21 pilot observed 674.49 ms startup, 321.05 MiB PSS, 10% sampled idle
CPU, and 14.15 MiB/s parser-oriented throughput for Shepherd. Those values came
from one measured sample on a host with 88.5% swap use. They identify areas to
investigate, but are not a publishable ranking or a reliable performance
baseline. See `benchmarks/results/2026-07-21-pilot.md`.

## Goals

- Make the terminal feel ready sooner without delaying the first usable shell.
- Increase sustained PTY-output throughput while preserving interactivity.
- Reduce steady-state CPU wakeups and memory retained per terminal.
- Keep GPU acceleration when available and a correct software-rendering fallback.
- Produce repeatable evidence for every accepted optimization.

This work must not weaken Electron sandboxing, IPC validation, process-discovery
bounds, terminal correctness, or restoration of user sessions. Matching a native
terminal's total memory use is not a realistic short-term target because
Chromium/Electron has a larger fixed runtime.

## Optimization principles

1. **Instrument before changing behavior.** A faster aggregate time is not useful
   if the changed stage is unknown.
2. **Change one bottleneck at a time.** Keep measurement, scheduling, output,
   rendering, and memory changes independently reviewable.
3. **Protect latency while improving throughput.** Large batches can improve bulk
   output but make typing feel delayed; both paths need separate acceptance gates.
4. **Measure production builds.** Development-mode React and Electron overhead
   must not drive product decisions.
5. **Keep raw samples.** Compare distributions and confidence, not only the best
   run or a single median.

## Recommended work

### 1. Add runtime performance instrumentation

Status: implemented. See `learning/M17-runtime-performance-instrumentation.md`
for the code walkthrough and `textbook/29-runtime-performance-observability.md`
for the architecture and tradeoffs.

Create lightweight monotonic milestones for:

- main-process start and Electron ready;
- window creation and renderer bootstrap;
- xterm creation, initial fit, and WebGL load or fallback;
- PTY spawn, shell readiness, and first visible output;
- deferred service start and steady-state readiness.

Emit measurements only when an explicit diagnostic flag is enabled. Keep the
normal path free from file I/O and high-cardinality logging. Add a development
summary that makes the critical path visible without recording terminal content,
commands, environment variables, or prompts.

Acceptance gate: repeated measurements must show low instrumentation overhead,
and every startup phase must have a documented beginning and end.

### 2. Shorten the startup critical path

Status: implemented. See `learning/M18-deferred-background-startup.md` for the
code walkthrough and `textbook/30-startup-critical-path-scheduling.md` for the
architecture and scheduling tradeoffs.

Render the window, create xterm, and spawn the first PTY before starting work that
does not affect the first prompt. Candidate services to defer include automatic
agent discovery, Git/workspace metadata probing, session housekeeping, and
secondary sidebar refreshes.

Use readiness-driven scheduling rather than arbitrary long delays: start deferred
services after the first terminal is usable, then spread their initial work
across later event-loop turns. Preserve restored layout and workspace correctness;
do not display a fake prompt or readiness state.

Acceptance gate: the instrumented shell-ready milestone improves without
regressions in restore behavior, automatic discovery, metadata freshness, or
first-input handling.

### 3. Batch the PTY output pipeline

Status: implemented. See `learning/M19-terminal-output-batching.md` for the code
walkthrough, `textbook/31-bounded-terminal-output-flow.md` for the engineering
design, and `benchmarks/results/2026-07-29-output-batching.md` for the matched
production comparison.

Before this feature, the hot path handled every `node-pty` data event immediately
in `src/main/pty.ts`, updated inspection state, parsed OSC data, sent IPC, and
called `term.write` in `TerminalHost.tsx`. The delivered per-terminal batcher:

- coalesces adjacent output chunks over a very short interval or byte threshold;
- preserves byte order and terminal boundaries;
- performs inspection and OSC processing in a single pass where practical;
- avoids unnecessary string copies and React state updates;
- respects xterm write completion and applies bounded backpressure;
- flushes immediately for small interactive output and on exit/dispose.

The accepted implementation uses a 32 KiB target, a 4 ms time cap, a 128 KiB
normal in-flight window, and 256/64 KiB PTY pause/resume watermarks. The matched
comparison validates that configuration against the unbatched baseline. A
4–32 KiB parameter sweep remains an extension point before any adaptive tuning.

Acceptance evidence: median parser-oriented throughput improved 21.48%, with the
candidate winning all 20 paired rounds. Startup, idle CPU, and memory remained
effectively unchanged. Tests and live Electron proof cover input echo, prompt
display, OSC handling, exit ordering, Unicode boundaries, and the bounded queue.

### 4. Reduce idle polling and duplicate work

Status: implemented. See `learning/M20-adaptive-runtime-polling.md` for the code
walkthrough, `textbook/32-adaptive-event-driven-observation.md` for the
engineering design, and
`benchmarks/results/2026-07-30-adaptive-runtime-polling.md` for the matched
production comparison.

Audit recurring work in `agentDiscovery.ts`, `workspaceMetadata.ts`, `App.tsx`,
and sidebar age rendering. Consolidate timers where their wakeups can safely
share a scheduler. Prefer event-triggered invalidation plus adaptive polling:

- rescan process ancestry when terminal activity or foreground PID changes;
- back off scans for quiet terminals and reset promptly on activity;
- check Git metadata only for the active surface or when its cwd changes;
- watch or cheaply re-read Git `HEAD`, retaining a slow probe for `git init`;
- slow or pause nonessential refreshes while the window is hidden or minimized;
- skip reducer dispatches and IPC messages when derived data is unchanged.

Polling must remain bounded and self-healing because `/proc` and filesystem
watchers can race or miss events. Exact discovery and branch freshness
requirements should be stated before changing intervals.

Acceptance gate: steady-state CPU and wakeups fall over a multi-second sample,
while agent appearance/removal and cwd/branch changes remain within documented
latency bounds.

The accepted implementation uses content-free terminal activity to accelerate
non-overlapping scans, then backs agents off to five seconds and metadata to
three seconds while quiet. Hidden windows retain a 15-second recovery cadence,
and restoration runs immediately. Renderer lifecycle transitions use exact
deadlines, while empty or hidden elapsed-label timers stop.

Acceptance evidence: configured quiet no-agent callbacks fell from 206 to 32 per
minute. In a matched 20-sample production comparison after an eight-second
settle, median idle CPU fell from 7.8% to 7.2%. The candidate was lower in 17
paired rounds, tied three, and was never higher. Startup, memory, and parser
throughput stayed neutral. Live Electron proof covered agent appearance/removal
and cwd/branch refresh; the benchmark report records its end-of-run pressure
qualification.

### 5. Control terminal memory and lifecycle

Status: implemented. See `learning/M21-terminal-memory-lifecycle.md` for the code
walkthrough, `textbook/33-terminal-memory-and-ownership.md` for the engineering
design, and
`benchmarks/results/2026-07-30-terminal-memory-lifecycle.md` for the
pressure-qualified comparison.

Measure the fixed Electron cost separately from incremental cost per terminal.
Use heap snapshots, process PSS, and terminal-count scaling to inspect:

- xterm scrollback and alternate-screen buffers;
- terminal inspection input/output rings;
- duplicate IPC or parser buffers;
- WebGL textures and addon disposal;
- listeners, observers, timers, closures, and hidden terminal components;
- session-state copies retained in renderer or main.

Make scrollback and capture limits explicit and bounded. Verify that closing a
terminal releases its PTY record, inspection buffers, xterm instance, WebGL
resources, IPC subscriptions, resize observer, and event listeners. Do not reduce
useful history merely to win a one-terminal memory sample; any new limit must
have a user-facing rationale or configuration path.

Acceptance gate: PSS growth from 1 to 2, 4, and 8 terminals becomes explainable,
closed-terminal memory trends back toward baseline after garbage collection and
settling, and repeated open/close cycles do not show monotonic growth.

The accepted implementation binds each PTY to its creator `WebContents`.
Creator-only checks cover replacement, input, resize, output acknowledgement, and
disposal. Renderer destruction or failure releases all associated terminals
through one owner subscription, and expected-value removal prevents delayed exit
or cleanup callbacks from touching replacements.

Retention limits are explicit: xterm keeps 1,000 scrollback lines, inspection
keeps 256 KiB per terminal, OSC keeps an 8 KiB incomplete tail, and output keeps
its existing acknowledged byte/watermark bounds. Exact opt-in diagnostics report
only aggregate counts and bytes.

Acceptance evidence: the full process tree used about 325 MiB PSS at one
terminal and added roughly 4.7–5.0 MiB per terminal. Process counts were
7/8/10/14 at 1/2/4/8 PTYs. All 64 checked candidate recovery points returned to
one terminal, one owner, one inspection capture, zero queued output, and zero
paused PTYs. A matched 30-cycle run showed the same Electron allocator high-water
steps in baseline and candidate; candidate ended 1.5 MiB lower. Host swap use was
74.9%, so these absolute values remain pilot evidence rather than a publishable
hardware baseline.

### 6. Tune rendering and resize behavior

Record whether WebGL loaded successfully instead of silently treating every
fallback as equivalent. Keep automatic fallback for systems without a usable
GPU. Compare the WebGL and software paths separately.

Coalesce resize observations to at most once per animation frame, run `fit()` only
when the visible dimensions changed, and send PTY resize IPC only when rows or
columns changed. Avoid fitting hidden terminals. Measure long-scroll workloads,
rapid resize, frame cadence, and main/renderer CPU before tuning xterm options.

Acceptance gate: resize produces fewer redundant fits and IPC calls, both
renderers remain functional, context loss recovers safely, and visible-output
benchmarks show no new dropped or stale frames.

## Proposed PR sequence

| Order | Branch                           | Scope                                                    | Status      | Depends on                |
| ----: | -------------------------------- | -------------------------------------------------------- | ----------- | ------------------------- |
|     1 | `perf/runtime-instrumentation`   | Startup milestones and opt-in diagnostics                | Implemented | benchmark foundation      |
|     2 | `perf/defer-background-services` | Move noncritical services after first-terminal readiness | Implemented | PR 1                      |
|     3 | `perf/terminal-output-batching`  | Bounded batching, flow control, and hot-path tests       | Implemented | PR 1                      |
|     4 | `perf/adaptive-runtime-polling`  | Activity-aware agent and metadata scheduling             | Implemented | PR 1                      |
|     5 | `perf/terminal-memory-lifecycle` | Memory accounting, limits, and disposal fixes            | Implemented | expanded scaling suite    |
|     6 | `perf/render-resize-scheduling`  | WebGL visibility and coalesced fit/resize                | Planned     | rendered-output suite     |
|     7 | `benchmarks/performance-rerun`   | Controlled before/after results and analysis             | Planned     | accepted optimization PRs |

PRs 2–5 may be developed independently after instrumentation, but each must
rebase on the latest accepted baseline and report its own effect. Documentation
for implementation PRs must update `learning/`, `textbook/`, `ROADMAP.md`, and
`FEATURES.md` after behavior settles.

## Measurement and acceptance

Run focused regression tests during development and the complete repository
quality gate before every PR:

```sh
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
```

Performance evidence must use a production bundle, a clean recorded commit,
stable AC power and CPU policy, low background load, no more than 50% swap use,
at least 25% available memory, five warmups, and twenty measured rounds. Report
median, p95, MAD/range, failures, versions, and host state. Run:

- warm unpacked and AppImage startup;
- parser completion and visibly settled rendering as separate workloads;
- interactive input latency;
- scrolling and resize behavior;
- idle CPU over a meaningful interval;
- process-tree PSS and private memory;
- 1, 2, 4, and 8 terminal scaling;
- agent-discovery overhead enabled and disabled;
- WebGL and software-rendering paths.

An optimization is accepted only when its target metric improves beyond normal
run variance, correctness tests pass, and important counter-metrics do not
regress. If results are neutral, keep useful instrumentation but revert behavioral
complexity.

## Directional targets

These are investigation targets, not release promises:

- warm process-to-shell-ready startup: 400–500 ms;
- one-workspace steady PSS: 230–280 MiB;
- parser-oriented throughput: above 25 MiB/s;
- steady idle CPU: below 1% over a representative interval.

Targets must be revised after a valid baseline. User-perceived latency, stability,
and correctness take priority over hitting an isolated number.

## Risks and rejected shortcuts

- Do not enable unsafe Electron single-process or sandbox-disabling flags to
  reduce process count.
- Do not suppress discovery, metadata, inspection, or OSC behavior without
  replacing it with behavior that meets the same product contract.
- Do not optimize against GNOME Terminal's shared-server memory number as though
  it were an isolated native process.
- Do not claim GPU rendering is always faster; drivers, remote sessions, and
  software fallback require separate results.
- Do not increase output batch latency, discard terminal bytes, or create
  unbounded queues for a better throughput headline.
- Do not start a Tauri, native renderer, or libghostty rewrite before profiling
  shows the Electron fixed cost blocks an explicit product requirement. That is a
  separate long-term architecture decision, not a local performance patch.

## Definition of done

- A controlled baseline and raw samples exist for the metric being changed.
- Profiling identifies a specific bottleneck and its owner.
- The change is isolated on a feature branch with scoped commits and tests.
- Before/after data includes variance and relevant counter-metrics.
- Correctness, security boundaries, fallbacks, and cleanup remain intact.
- Code-focused learning material and engineering textbook material match the
  final implementation.
- A final controlled rerun documents cumulative gains and remaining bottlenecks.
