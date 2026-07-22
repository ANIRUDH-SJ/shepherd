# M16 — Reproducible terminal benchmark foundation

## The goal

M16 turns “is cmux-linux faster?” from an impression into a repeatable
experiment. It builds and smoke-tests production artifacts, then gives every
terminal the same child worker and fixture. The first suite measures startup,
settled memory, idle CPU, and parser-confirmed output throughput while retaining
raw samples and the host environment.

This milestone does not claim rendered-frame throughput, input-to-photon latency,
scroll smoothness, resize behavior, or multi-terminal scalability. Those suites
remain explicit follow-up work.

## What changed

| File                                      | Responsibility                                      |
| ----------------------------------------- | --------------------------------------------------- |
| `benchmarks/terminalBenchmarkLib.ts`      | Validation, fixtures, statistics, and `/proc` math  |
| `benchmarks/terminalBenchmarkLib.test.ts` | Pure regression tests for the measurement boundary  |
| `benchmarks/terminalBenchmarkWorker.ts`   | Identical TTY child and parser-completion probe     |
| `benchmarks/terminalBenchmark.ts`         | Launch, sample, clean up, summarize, and write JSON |
| `benchmarks/subjects.example.json`        | Versioned subject-configuration example             |
| `benchmarks/README.md`                    | Operator commands, result semantics, and warnings   |
| `package.json` / `tsconfig.node.json`     | npm entry point, test wiring, and typechecking      |
| `TERMINAL_BENCHMARK_PLAN.md`              | Full suite checklist and guardrails                 |

## 1. Configuration is data, not shell code

`validateBenchmarkConfig()` accepts schema version 1 and at most twelve uniquely
named subjects. Commands must be absolute paths. Argument arrays are passed
straight to `spawn()`; only the complete `{shell}` argument is substituted.
Environment keys, values, process names, paths, and list lengths are bounded.

Two launch modes cover the current comparison:

- `terminal` places the generated worker shell into a terminal's argv;
- `cmux` sets `SHELL` to that worker because cmux-linux creates its first PTY
  internally.

The source string and a version command make the eventual result self-describing.
`relatedCommands` is narrow allowlist data for measuring a detached/shared server
such as GNOME Terminal's 15-character Linux process name.

## 2. Deterministic fixtures and statistics

`createFixture()` builds bounded ASCII, valid Unicode, or ANSI text before a
timed sample starts. The result includes the actual byte count and SHA-256 digest,
so two result files can prove they used identical input.

`summarizeSamples()` retains count, minimum, maximum, arithmetic mean, median,
nearest-rank p95, and median absolute deviation. The raw samples remain the
source of truth; summaries are derived convenience values.

The library also parses `/proc/<pid>/stat` without breaking on command names that
contain spaces, parses `smaps_rollup`, and sums RSS, PSS, private memory, and
proportional swap across a selected process set.

## 3. One child worker for every terminal

The runner transpiles `terminalBenchmarkWorker.ts` once per suite and launches
plain Node inside every subject. This deliberately keeps `tsx` and esbuild out of
the measured terminal process set.

The worker checks that it owns a controlling TTY, enables raw input, loads the
fixture, then creates an exclusive readiness record containing its PID and
monotonic timestamp. Startup ends at that record: the terminal is alive, has
created a PTY, and has launched the same prepared child.

For output measurement the runner sends `SIGUSR1`. The worker writes the fixture
followed by Device Status Report query `ESC[5n`. A conforming terminal answers
`ESC[0n` only after its parser reaches that final query. The worker then writes a
completion timestamp through an out-of-band file. This avoids mistaking “all
bytes were written” for “the terminal parser consumed them.” It still does not
prove that the final pixels reached the monitor, so the field is explicitly
named `parserRoundTripMs`.

## 4. Process accounting

Electron uses several processes, Kitty can use a helper, and GNOME Terminal can
hand the new window to a shared server. Measuring only the launcher PID would
make the comparison meaningless.

`processIdentities()` takes a bounded snapshot of numeric `/proc` entries and
marks processes carrying a random per-sample `CMUX_BENCH_RUN_ID`. Measurement
starts with the launcher tree, finds the marked worker even after a server handoff,
and follows only explicitly allowed ancestor command names. The worker is removed
from memory and CPU totals because it is common test equipment.

PSS comes from `smaps_rollup`, so a shared page is divided among processes rather
than counted in full for every Chromium child. Idle CPU compares process tick
deltas over a configured interval using the host's `CLK_TCK` value.

## 5. Cleanup is intentionally narrower than measurement

The first live GNOME validation exposed an important ownership bug: measurement
correctly included `gnome-terminal-server`, but cleanup reused that broad set and
closed unrelated GNOME Terminal windows. The corrected design has two selectors:

- `selectMeasuredProcessIds()` may include an allowlisted shared ancestor;
- `selectCleanupProcessIds()` requires the unique run marker, protects shared
  command names, and follows only the verified benchmark launch tree.

Before signaling the worker, cleanup verifies that its current PID still carries
the same marker. `SIGTERM` gets a grace interval before `SIGKILL`. The regression
suite includes a marked shared server and proves it remains outside the cleanup
set. A corrected four-subject live pilot then completed with no failures or
surviving benchmark processes. The runner also registers `SIGINT` and `SIGTERM`
handlers around the active sample; both await the same idempotent cleanup promise
before exiting with the conventional signal status.

## 6. Pressure gates and result classification

Before opening a terminal, `memoryPressure()` reads `/proc/meminfo`. Fewer than
25% available memory or more than 50% used swap rejects a normal run. The
operator can use `--allow-pressure` only to debug the harness; that flag, fewer
than five warmups, or fewer than twenty samples forces `classification: pilot`.

Subject order is deterministically shuffled for each round. Every child receives
private launch-time XDG directories, a unique socket, bounded readiness/parser
timeouts, and minimal allowlisted host environment. Failures are retained with
their round and log path instead of silently reducing the sample count. Output is
written exclusively under `/tmp` or `benchmarks/results`. A fully written
temporary file is published with an exclusive hard link, so a concurrent or
pre-existing result is never overwritten.

## Production and live verification

The production gate built fresh artifacts and smoke-tested the AppImage under an
isolated X server. The application opened one workspace, its Unix socket answered,
the packaged node-pty executed a sentinel shell command, the bundled CLI ran, and
shutdown was clean.

- AppImage: 128,450,155 bytes; SHA-256
  `5b78f51df740af6560f86709843aba75b2e8489ad584425aca8898659da52506`
- Debian package: 100,454,264 bytes; SHA-256
  `e847dbc981cc427a0f3dbe5733d6cb773f2a5617f69ba5ba68270765f82344e2`

The four-subject harness pilot used cmux-linux, Kitty 0.48.0, Ghostty 1.3.1, and
GNOME Terminal 3.52.0. It validated launch, process accounting, the DSR round
trip, cleanup, and JSON generation. Its 88.5% swap-use baseline makes its timing
non-publishable; the JSON correctly labels it `pilot`, and no performance ranking
is drawn from it.

A separate interruption smoke test stopped Kitty during a 60-second settle
window. The harness returned exit code 130, published no partial result, and left
no Kitty or worker process. A no-overwrite integration check also rejected an
existing result path before launching a subject.

## Checkpoint

1. Why is PSS more useful than summed RSS for Electron's process tree?
2. What does the DSR response prove, and what does it not prove?
3. Why must measurement ownership be broader than cleanup ownership?
4. Which conditions force a result to be labelled `pilot`?
5. Why is the benchmark worker excluded from resource totals?
