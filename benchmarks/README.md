# Terminal Benchmark Harness

This harness compares production terminal builds with the same child worker and
fixture. It currently measures process-to-worker-ready startup, settled process
memory, sampled idle CPU, and a parser-confirmed output round trip. It does not
claim input-to-photon latency or rendered-frame throughput.

## Recorded reports

- [`results/2026-07-30-terminal-memory-lifecycle.md`](./results/2026-07-30-terminal-memory-lifecycle.md)
  — pressure-qualified before/after production measurements at 1/2/4/8 PTYs,
  repeated 8→1 recovery, and exact candidate resource-count evidence.
- [`results/2026-07-30-adaptive-runtime-polling.md`](./results/2026-07-30-adaptive-runtime-polling.md)
  — matched before/after production comparison for activity-aware observation,
  exact renderer deadlines, idle CPU, and deterministic schedule counts.
- [`results/2026-07-29-output-batching.md`](./results/2026-07-29-output-batching.md)
  — matched before/after production comparison for bounded, acknowledged PTY
  output batching, including counter-metrics and pressure qualifications.
- [`results/2026-07-21-pilot.md`](./results/2026-07-21-pilot.md) — four-terminal
  harness-validation pilot; retained for raw observations and limitations, not a
  publishable ranking.

## Prerequisites

- Linux with readable `/proc/<pid>/stat`, `/proc/<pid>/environ`, and
  `/proc/<pid>/smaps_rollup`
- An active X11 display and absolute paths to every terminal executable
- A production Shepherd build from `npm run dist:dir` or `npm run dist`
- Low background load, at least 25% available memory, and no more than 50% swap
  use for a publishable run

Copy `subjects.example.json` outside the repository, replace its example paths
and source descriptions, and add other terminals as needed. Each terminal-mode
subject must place `{shell}` where its child command belongs. Commands are
executed directly with argv; the harness never invokes a shell to interpret the
configuration.

## Run

```bash
npm run benchmark -- run \
  --config /tmp/shepherd-bench-subjects.json \
  --output benchmarks/results/terminal-$(date +%F).json
```

Defaults are five warmups, twenty measured samples, a two-second settling
period, a one-second CPU window, and an 8 MiB ANSI fixture. Useful options:

```bash
# Validate one subject without presenting the result as final evidence.
npm run benchmark -- run --config /tmp/subjects.json \
  --output /tmp/shepherd-pilot.json --subjects shepherd-unpacked \
  --warmups 1 --samples 1 --allow-pressure

# Exercise valid UTF-8 text instead of ANSI color changes.
npm run benchmark -- run --config /tmp/subjects.json \
  --output benchmarks/results/unicode.json --fixture unicode
```

`--allow-pressure`, fewer than five warmups, or fewer than twenty samples marks
the entire output as `pilot`. Without that override, high memory or swap pressure
stops the run before a terminal is launched.

## Terminal lifecycle measurements

The separate lifecycle runner measures fixed Electron cost, incremental
per-terminal PSS, process composition, and repeated open/close recovery:

```bash
npm run benchmark:lifecycle -- run \
  --config /tmp/shepherd-lifecycle-subjects.json \
  --output /tmp/shepherd-lifecycle-results.json
```

It expects `shepherd`-mode production subjects using the same validated configuration
schema. Defaults are five fresh runs, three samples at each of 1/2/4/8 live
terminals, and ten 8→1 recovery cycles. Candidate builds may emit opt-in
`[shepherd:memory]` snapshots; the runner verifies terminal, owner, inspection,
queued-output, and paused-PTY counts without storing terminal content.

Each directly spawned application PID is the root ownership proof. Cleanup
records process start ticks before signaling the root and descendants, then
rechecks those ticks before escalation so PID reuse cannot target an unrelated
process. Chromium helpers whose sanitized role is unavailable are reported as a
combined `electron:helper` group.

## Shepherd startup diagnostics

The external harness measures every terminal through the same worker. To explain
where Shepherd spends its own startup time, enable its separate internal trace:

```bash
SHEPHERD_PERF_DIAGNOSTICS=1 npm run start
```

The app writes one `[shepherd:perf]` JSON line to its process output. It timestamps a
fixed, content-free sequence across Electron main, backend registration, window
creation, React, xterm, WebGL or fallback, node-pty, and first written terminal
output. The same record separates first-terminal readiness from the later
activation of agent and workspace metadata observers. It records no terminal
text, commands, arguments, paths, prompts, or environment contents. Diagnostics
are disabled for every other environment value and do not write a file.

Use the trace to locate a Shepherd phase, not to compare different terminals.
External harness results remain the independent before/after acceptance measure.

## Result semantics

- `startupMs`: process spawn until the child worker has a controlling TTY and
  has loaded the fixture.
- `pssKiB`: proportional memory across the measured terminal process set; use
  this rather than summed RSS for cross-process comparisons.
- `idleCpuPercent`: process CPU ticks accumulated during the configured interval;
  values may exceed 100% for multithreaded subjects.
- `parserRoundTripMs`: fixture write plus a Device Status Report response. This
  proves the parser consumed the final probe, not that the last frame reached the
  monitor.

The JSON retains every warmup, sample, failure, environment record, fixture
digest, and median/p95/MAD summary. Subject order is deterministically shuffled
by round. Result publication is exclusive: an existing output path is rejected
and never replaced.

## Safety and cleanup

Every sample's launch environment receives private XDG directories, a unique
Shepherd socket, a bounded timeout, and a random run marker. A pre-existing shared
terminal server can retain its existing profile and state, so record that as a
comparison limitation. Measurement can include an allowlisted shared server such
as `gnome-terminal-server`; cleanup deliberately cannot signal that server. Only
marker-verified launch trees and workers are terminated. Do not interact with
the benchmark windows while a run is active. `SIGINT` and `SIGTERM` run the same
idempotent cleanup before the harness exits.
