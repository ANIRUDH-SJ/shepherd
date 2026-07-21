# Terminal Performance Benchmark Plan

## Goal

Measure cmux-linux against representative Linux terminals without collapsing
startup, latency, throughput, memory, and scalability into one misleading score.
The benchmark must be reproducible, retain raw samples, and distinguish pilot
runs from publishable results.

## Comparison set

- cmux-linux production AppImage and unpacked production binary
- GNOME Terminal as the installed desktop baseline
- Kitty as a purpose-built GPU terminal
- Ghostty as a native, threaded GPU terminal

Record exact versions, package sources, display server, compositor, CPU, memory,
GPU/driver, kernel, font, window geometry, refresh rate, shell, and configuration.
If a terminal is unavailable, report it explicitly instead of silently changing
the comparison set.

## Delivery sequence

### 1. Production baseline

- [ ] Run tests, lint, typecheck, and production build from synchronized `main`
- [ ] Produce fresh AppImage and `.deb` artifacts
- [ ] Smoke-test startup, terminal creation, input, output, and clean shutdown
- [ ] Verify the packaged CLI and native `node-pty` addon
- [ ] Record artifact sizes and SHA-256 checksums without committing installers

### 2. Reproducible harness

- [ ] Add deterministic ASCII, Unicode, and ANSI/control-sequence fixtures
- [ ] Capture environment and terminal versions in machine-readable form
- [ ] Launch every subject with isolated configuration and state directories
- [ ] Bound every subprocess with explicit readiness and shutdown timeouts
- [ ] Measure full process-tree PSS/RSS and sampled idle CPU
- [ ] Retain individual samples and calculate median, p95, spread, and failures
- [ ] Test the parsers, statistics, validation, and cleanup behavior

### 3. Measurement suites

- [ ] Measure warm process-to-shell-ready startup separately from AppImage startup
- [ ] Measure idle memory and CPU after a fixed settling period
- [ ] Measure parser-oriented and visibly rendered output workloads separately
- [ ] Measure automated scroll and resize behavior with frame/CPU observations
- [ ] Measure 1, 2, 4, and 8 terminal scalability where equivalent layouts exist
- [ ] Measure cmux-linux agent discovery overhead independently of terminal count
- [ ] Run a redirected CPU workload as a terminal-independent control
- [ ] Label software input-to-present latency separately from hardware latency

### 4. Controlled execution

- [ ] Stop unrelated benchmark subjects without disrupting user terminals
- [ ] Use AC power, a stable CPU policy, fixed display geometry, and matching fonts
- [ ] Require a low, recorded memory/swap and background-CPU baseline
- [ ] Randomize subject order and run at least five warmups plus twenty samples
- [ ] Keep pilot data separate from final raw measurements
- [ ] Record missing capabilities and incomparable cases rather than estimating

### 5. Analysis and delivery

- [ ] Publish raw JSON/CSV, exact commands, validation output, and summarized tables
- [ ] Explain confidence, confounders, vendor-authored benchmarks, and limitations
- [ ] Add a code walkthrough to `learning/`
- [ ] Add architecture, alternatives, security, and tradeoffs to `textbook/`
- [ ] Update relevant indexes, roadmap entries, and feature documentation
- [ ] Run the complete repository quality gate and public-content scan
- [ ] Review, open a dedicated PR, and merge only reproducible work

## Measurement definitions

`startup` ends when the launched shell emits a harness nonce through an
out-of-band readiness channel. `idle` begins only after a fixed settling period.
Memory is the sum of proportional set size across the owned process tree so
Chromium subprocesses are not omitted or shared pages double-counted. CPU is
sampled over time, not read from one instantaneous process listing.

Parser throughput uses pre-generated fixtures and excludes fixture generation.
Rendered-output tests require a final nonce and a settled presentation check so
asynchronous renderers cannot finish timing while frames remain queued. A result
that cannot meet these definitions is reported as a proxy with its narrower
meaning.

## Guardrails

- Never run performance measurements through `npm run dev`.
- Never use `sudo`, drop global filesystem caches, or change the host CPU policy
  from the harness.
- Never reuse the user's normal XDG state, socket, or terminal configuration.
- Never kill processes the harness did not launch and identify itself.
- Reject malformed subject definitions, unsafe paths, invalid sample counts, and
  unbounded commands.
- Generated packages remain under ignored `release/`; only intentional benchmark
  fixtures, harness code, raw data, and documentation may enter the PR.
