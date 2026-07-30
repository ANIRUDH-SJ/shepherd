# Adaptive Runtime Polling Comparison — 2026-07-30

> **Decision: retain adaptive polling.** Against the exact pre-feature
> production build, median settled idle CPU fell from 7.8% to 7.2%. The
> candidate used less CPU in 17 paired rounds, tied three, and was never higher.
> Startup, process memory, and parser throughput remained effectively neutral.

Run completed: 2026-07-30 15:24:26 UTC (20:54:26 IST). The harness classified
the run as `publishable` from its pre-run pressure gate. Recorded failures: 0.

## Compared builds

| Subject         | Commit                                     | Source                                           |
| --------------- | ------------------------------------------ | ------------------------------------------------ |
| Fixed intervals | `240fb9e70c7e0855c02a20d330af85fb646dcf07` | Merge immediately before adaptive polling        |
| Adaptive        | `fd91d1c2637a89f6e6c530f677f051db20a284ff` | Production build with the settled implementation |

Both subjects were fresh unpacked `npm run dist:dir` builds using the same
dependency installation and native-module ABI.

## Results

Lower is better except for throughput. MAD is median absolute deviation. Each
summary contains 20 measured samples after five warm-ups.

| Metric                    | Before median | Before p95 | Before MAD | After median | After p95 | After MAD | Median change |
| ------------------------- | ------------: | ---------: | ---------: | -----------: | --------: | --------: | ------------: |
| Startup (ms)              |        542.83 |     613.23 |       8.59 |       546.39 |    590.25 |     15.48 |        +0.66% |
| PSS (MiB)                 |        142.01 |     155.30 |       3.43 |       141.59 |    154.97 |      3.36 |        -0.30% |
| RSS (MiB)                 |        665.76 |     667.80 |       1.25 |       664.89 |    668.42 |      2.41 |        -0.13% |
| Idle CPU (%)              |          7.80 |       8.00 |       0.20 |         7.20 |      7.80 |      0.20 |    **-7.69%** |
| Parser round trip (ms)    |        284.51 |     318.27 |      11.76 |       288.57 |    297.68 |      4.96 |        +1.43% |
| Parser throughput (MiB/s) |         28.12 |      29.87 |       1.16 |        27.72 |     29.33 |      0.49 |        -1.41% |

Mean idle CPU fell from 7.69% to 7.16%, a 0.53 percentage-point or 6.89%
relative reduction. The median paired reduction was 0.6 percentage points.
Differences in the counter-metrics are too small or inconsistent to call
improvements or regressions.

## Recurring schedule count

This deterministic counter-metric counts configured callbacks, not kernel
wakeups or equal-cost operations.

| Quiet, no-agent schedule    | Fixed callbacks/min | Adaptive callbacks/min |
| --------------------------- | ------------------: | ---------------------: |
| Automatic agent discovery   |                  60 |                     12 |
| Workspace metadata          |                  80 |                     20 |
| Renderer lifecycle dispatch |                  60 |                      0 |
| Empty agent elapsed refresh |                   6 |                      0 |
| **Total**                   |             **206** |                 **32** |

That is 84.47% fewer recurring callbacks while visible and quiet. When hidden,
the two bounded recovery scans run four times per minute each and the renderer
runs no recurring lifecycle or empty-list refresh timer.

## Methodology

- Five warm-ups and 20 measured rounds per subject
- Deterministically shuffled subject order with seed `0x6d2b79f5`
- 8,388,652-byte ANSI fixture, SHA-256
  `2bcc7bd9ddf0b6604a6ff18330259d6b546b376a12a227d8cd223d770f9f25bf`
- Eight-second settling period, beyond the five-second activity burst
- Five-second process-tree CPU sample
- Process-tree PSS/RSS from Linux `/proc`
- Device Status Report proof that xterm parsed the final probe
- Isolated X11 display, private sockets, sessions, and XDG directories
- 12th Gen Intel Core i5-12450H, 15.35 GiB RAM, Node v22.20.0

Every sample measured seven processes. Sampled swap PSS was zero for the
baseline and at most 216 KiB for the adaptive build. A separate live Electron
run proved repository and branch refresh plus automatic agent appearance and
removal.

## Pressure qualification

The run began inside the publication gate: 37.55% of memory was available and
41.33% of swap was used. After 50 launches, only 10.46% of memory was available
and swap use reached 99.57%. The harness currently assigns classification from
pre-run pressure.

Deterministic interleaving, zero failures, and the 17-win/3-tie/0-loss paired
idle-CPU result support accepting this isolated change. A cumulative performance
rerun should repeat it on a freshly settled host. This report does not claim
input-to-photon latency, rendered-frame throughput, or a reduction in Electron's
fixed process cost.

## Raw-result identity

The complete JSON remains local at
`/tmp/cmux-adaptive-benchmark-results.json`. It is not committed because it
contains machine-specific absolute paths and detailed host inventory.

Raw JSON SHA-256:
`203da6382f58e3afe456c59fc8e7bbde2392f847aa3cb8b9caf6ae04cd148780`.
