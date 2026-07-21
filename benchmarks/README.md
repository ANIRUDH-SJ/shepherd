# Terminal Benchmark Harness

This harness compares production terminal builds with the same child worker and
fixture. It currently measures process-to-worker-ready startup, settled process
memory, sampled idle CPU, and a parser-confirmed output round trip. It does not
claim input-to-photon latency or rendered-frame throughput.

## Prerequisites

- Linux with readable `/proc/<pid>/stat`, `/proc/<pid>/environ`, and
  `/proc/<pid>/smaps_rollup`
- An active X11 display and absolute paths to every terminal executable
- A production cmux-linux build from `npm run dist:dir` or `npm run dist`
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
  --config /tmp/cmux-bench-subjects.json \
  --output benchmarks/results/terminal-$(date +%F).json
```

Defaults are five warmups, twenty measured samples, a two-second settling
period, a one-second CPU window, and an 8 MiB ANSI fixture. Useful options:

```bash
# Validate one subject without presenting the result as final evidence.
npm run benchmark -- run --config /tmp/subjects.json \
  --output /tmp/cmux-pilot.json --subjects cmux-unpacked \
  --warmups 1 --samples 1 --allow-pressure

# Exercise valid UTF-8 text instead of ANSI color changes.
npm run benchmark -- run --config /tmp/subjects.json \
  --output benchmarks/results/unicode.json --fixture unicode
```

`--allow-pressure`, fewer than five warmups, or fewer than twenty samples marks
the entire output as `pilot`. Without that override, high memory or swap pressure
stops the run before a terminal is launched.

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
by round.

## Safety and cleanup

Every sample's launch environment receives private XDG directories, a unique
cmux socket, a bounded timeout, and a random run marker. A pre-existing shared
terminal server can retain its existing profile and state, so record that as a
comparison limitation. Measurement can include an allowlisted shared server such
as `gnome-terminal-server`; cleanup deliberately cannot signal that server. Only
marker-verified launch trees and workers are terminated. Do not interact with
the benchmark windows while a run is active.
